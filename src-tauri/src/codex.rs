//! Fixed, read-only account API bridge. Never starts a model turn.
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
    time::timeout,
};

type Shared = Arc<Mutex<Option<Server>>>;
#[derive(Default)]
pub struct Connections(pub Mutex<HashMap<String, Shared>>);

pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid profile ID".into());
    }
    Ok(())
}

fn codex_executable() -> PathBuf {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .filter(|p| p.is_absolute())
                .map(|p| p.join(name)),
        );
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
        candidates.push(PathBuf::from("/usr/local/bin/codex"));
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    if let Some(home) = home {
        candidates.push(PathBuf::from(home).join(".local").join("bin").join(name));
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(name))
}

pub struct Server {
    _child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next_id: u64,
    pending_login: Option<String>,
    login_failed: bool,
}

impl Server {
    async fn start(profile: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&profile).map_err(|_| "Could not create account profile")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&profile, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "Could not protect account profile")?;
        }
        // CODEX_HOME is deliberately unique per account, never the user's CLI home.
        // Require the native binary on PATH; do not execute arbitrary shell commands.
        let mut cmd = Command::new(codex_executable());
        cmd.args(["app-server", "-c", "cli_auth_credentials_store=\"keyring\""])
            .env("CODEX_HOME", &profile)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY")
            .current_dir(&profile)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let mut child = cmd.spawn().map_err(|_| "Could not launch Codex. Install the official native Codex binary on PATH, then restart Quota Otter.")?;
        let stdin = child.stdin.take().ok_or("No Codex input stream")?;
        let stdout = child.stdout.take().ok_or("No Codex output stream")?;
        let mut server = Self {
            _child: child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            next_id: 0,
            pending_login: None,
            login_failed: false,
        };
        server.call("initialize", json!({ "clientInfo": { "name": "quota_otter", "title": "Quota Otter", "version": "0.1.0" } })).await?;
        server
            .send(json!({"method":"initialized","params":{}}))
            .await?;
        Ok(server)
    }

    async fn send(&mut self, value: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&value).map_err(|_| "Could not encode request")?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .map_err(|_| "Codex connection closed")?;
        self.stdin
            .flush()
            .await
            .map_err(|_| "Codex connection closed".to_string())
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        timeout(Duration::from_secs(35), async {
            let mut early_completions = HashMap::new();
            self.send(json!({"id":id,"method":method,"params":params})).await?;
            while let Some(line) = self.lines.next_line().await.map_err(|_| "Could not read Codex response")? {
                let message: Value = serde_json::from_str(&line).map_err(|_| "Codex returned an invalid response")?;
                if message.get("method").and_then(Value::as_str)==Some("account/login/completed") {
                    let params=&message["params"];
                    if let Some(login_id) = params["loginId"].as_str() {
                        let failed = params["success"].as_bool()!=Some(true);
                        if Some(login_id)==self.pending_login.as_deref() {
                            self.pending_login=None;
                            self.login_failed=failed;
                        } else if method=="account/login/start" {
                            early_completions.insert(login_id.to_owned(), failed);
                        }
                    }
                }
                if message.get("id").and_then(Value::as_u64) != Some(id) { continue; }
                // Do not forward raw upstream errors or tokens to the webview/logs.
                if message.get("error").is_some() {
                    return Err("Codex could not complete this request. Check your sign-in, OS credential store, connection, and Codex version.".into());
                }
                let result=message.get("result").cloned().ok_or_else(|| "Codex response is missing its result".to_string())?;
                if method=="account/login/start" {
                    self.pending_login=result["loginId"].as_str().map(str::to_owned);
                    self.login_failed=false;
                    if let Some(failed)=self.pending_login.as_ref().and_then(|id| early_completions.remove(id)) {
                        self.pending_login=None;
                        self.login_failed=failed;
                    }
                }
                if method=="account/login/cancel" || method=="account/logout" {self.pending_login=None;self.login_failed=false;}
                return Ok(result);
            }
            Err("Codex exited. Check that your OS credential store is available and update Codex if needed.".into())
        }).await.map_err(|_| "Codex timed out. Retry when online; sign in again if needed.".to_string())?
    }
}

impl Connections {
    pub async fn request(
        &self,
        root: PathBuf,
        id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        validate_id(id)?;
        let shared = self
            .0
            .lock()
            .await
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone();
        let mut server = shared.lock().await;
        if server.is_none() {
            *server = Some(Server::start(root.join("profiles").join(id)).await?);
        }
        let result = server
            .as_mut()
            .ok_or("No Codex connection")?
            .call(method, params)
            .await;
        if result.is_err() {
            *server = None;
        } // Drop and kill dead/desynchronized processes.
        if method == "account/read" {
            if let Some(s) = server.as_ref() {
                if s.pending_login.is_some() {
                    return Err(
                        "Sign-in is still pending. Finish it in your browser, then try again."
                            .into(),
                    );
                }
                if s.login_failed {
                    return Err("Sign-in failed. Start a new sign-in.".into());
                }
            }
        }
        result
    }
    pub async fn remove(&self, id: &str) {
        if let Some(shared) = self.0.lock().await.remove(id) {
            *shared.lock().await = None;
        }
    }
}

pub fn safe_auth_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid sign-in URL")?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("auth.openai.com" | "chatgpt.com"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("Unexpected sign-in destination".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_profile_traversal() {
        for id in ["../other", "/tmp", "a/b", "", "x.y"] {
            assert!(validate_id(id).is_err());
        }
        assert!(validate_id("ef589b02-c569-4e30-830b-a12bb9591c7d").is_ok());
    }
    #[test]
    fn restricts_login_targets() {
        for url in [
            "http://auth.openai.com",
            "https://auth.openai.com.evil.test",
            "file:///tmp/a",
            "https://user@chatgpt.com",
            "https://chatgpt.com:444",
        ] {
            assert!(safe_auth_url(url).is_err());
        }
        assert!(safe_auth_url("https://auth.openai.com/oauth/authorize?state=abc").is_ok());
    }
    fn fake(script: &str) -> Server {
        let mut child = Command::new(if cfg!(windows) { "python" } else { "python3" })
            .args(["-u", "-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        Server {
            _child: child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            next_id: 0,
            pending_login: None,
            login_failed: false,
        }
    }
    #[test]
    fn rpc_ignores_notifications_and_matches_response_ids() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut server=fake("import sys,json\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({'method':'account/updated','params':{}}))\nprint(json.dumps({'id':999,'result':{}}))\nprint(json.dumps({'id':r['id'],'result':{'availableCount':2}}))");
            let result=server.call("account/rateLimits/read",json!({})).await.unwrap();
            assert_eq!(result["availableCount"],2);
        });
    }
    #[test]
    fn login_completion_handles_both_message_orders() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            for early in [true, false] {
                for success in [true, false] {
                    let script = format!(
                        "import sys,json\nr=json.loads(sys.stdin.readline())\nnotification={{'method':'account/login/completed','params':{{'loginId':'expected','success':{success}}}}}\nresponse={{'id':r['id'],'result':{{'loginId':'expected'}}}}\nprint(json.dumps({{'method':'account/login/completed','params':{{'loginId':'unrelated','success':True}}}}))\nif {early}:\n print(json.dumps(notification))\nprint(json.dumps(response))\nr=json.loads(sys.stdin.readline())\nif not {early}:\n print(json.dumps(notification))\nprint(json.dumps({{'id':r['id'],'result':{{}}}}))",
                        success = if success { "True" } else { "False" },
                        early = if early { "True" } else { "False" },
                    );
                    let mut server = fake(&script);
                    server.call("account/login/start", json!({})).await.unwrap();
                    assert_eq!(server.pending_login.is_none(), early);
                    server.call("account/read", json!({})).await.unwrap();
                    assert!(server.pending_login.is_none());
                    assert_eq!(server.login_failed, !success);
                }
            }
        });
    }
    #[test]
    fn rpc_redacts_upstream_errors_and_handles_eof() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut server=fake("import sys,json\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({'id':r['id'],'error':{'message':'SECRET_TOKEN'}}))");
            let error=server.call("account/read",json!({})).await.unwrap_err();assert!(!error.contains("SECRET_TOKEN"));
            let mut closed=fake("pass");assert!(closed.call("account/read",json!({})).await.is_err());
        });
    }
}
