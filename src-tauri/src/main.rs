#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod codex;
use codex::Connections;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};
static LAST_TRAY_UPDATE: AtomicU64 = AtomicU64::new(0);
fn epoch_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "Could not find local application directory".into())
}

#[tauri::command]
async fn begin_login(
    app: tauri::AppHandle,
    state: State<'_, Connections>,
    id: String,
) -> Result<Value, String> {
    let result = state
        .request(
            data_dir(&app)?,
            &id,
            "account/login/start",
            json!({"type":"chatgpt"}),
        )
        .await?;
    let raw = result
        .get("authUrl")
        .and_then(Value::as_str)
        .ok_or("Codex did not return a sign-in URL. Update Codex and try again.")?;
    let url = codex::safe_auth_url(raw)?;
    if open::that(url.as_str()).is_err() {
        let _ = state
            .request(
                data_dir(&app)?,
                &id,
                "account/login/cancel",
                json!({"loginId":result.get("loginId")}),
            )
            .await;
        return Err(
            "Could not open the system browser. Set a default browser and try again.".into(),
        );
    }
    Ok(json!({"loginId":result.get("loginId")}))
}

#[tauri::command]
async fn cancel_login(
    app: tauri::AppHandle,
    state: State<'_, Connections>,
    id: String,
    login_id: Option<String>,
) -> Result<(), String> {
    if let Some(login_id) = login_id {
        state
            .request(
                data_dir(&app)?,
                &id,
                "account/login/cancel",
                json!({"loginId":login_id}),
            )
            .await?;
    }
    Ok(())
}

#[tauri::command]
async fn read_usage(
    app: tauri::AppHandle,
    state: State<'_, Connections>,
    id: String,
) -> Result<Value, String> {
    let account = state
        .request(
            data_dir(&app)?,
            &id,
            "account/read",
            json!({"refreshToken":true}),
        )
        .await?;
    let identity = account
        .get("account")
        .filter(|v| !v.is_null())
        .ok_or("Not connected. Sign in with OpenAI to read this account's Codex limits.")?;
    if identity.get("type").and_then(Value::as_str) != Some("chatgpt") {
        return Err("This is not a ChatGPT subscription sign-in. Reconnect with OpenAI.".into());
    }
    let usage = state
        .request(data_dir(&app)?, &id, "account/rateLimits/read", json!({}))
        .await?;
    Ok(
        json!({ "account": {"email":identity.get("email"),"planType":identity.get("planType")}, "usage":usage }),
    )
}

#[tauri::command]
async fn disconnect(
    app: tauri::AppHandle,
    state: State<'_, Connections>,
    id: String,
) -> Result<(), String> {
    // Logout through the official API first; on failure retain the account in the UI.
    state
        .request(data_dir(&app)?, &id, "account/logout", json!({}))
        .await?;
    state.remove(&id).await;
    let path = data_dir(&app)?.join("profiles").join(&id);
    if path.exists() {
        std::fs::remove_dir_all(path)
            .map_err(|_| "Signed out, but could not remove the local profile. Retry removal.")?;
    }
    Ok(())
}

#[tauri::command]
fn update_tray(app: tauri::AppHandle, title: String, summary: String) -> Result<(), String> {
    if title.len() > 180 || summary.len() > 1000 {
        return Err("Tray text too long".into());
    }
    let tray = app.tray_by_id("quota").ok_or("Tray unavailable")?;
    #[cfg(not(target_os = "linux"))]
    tray.set_tooltip(Some(&summary))
        .map_err(|_| "Could not update tray")?;
    #[cfg(target_os = "macos")]
    tray.set_title(Some(&title))
        .map_err(|_| "Could not update menu-bar text")?;
    #[cfg(not(target_os = "macos"))]
    let _ = title;
    let summary_item = MenuItem::with_id(&app, "summary", summary, false, None::<&str>)
        .map_err(|e| e.to_string())?;
    let show = MenuItem::with_id(&app, "show", "Open Quota Otter", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let refresh = MenuItem::with_id(&app, "refresh", "Refresh usage", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit =
        MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&summary_item, &show, &refresh, &quit])
        .map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    LAST_TRAY_UPDATE.store(epoch_seconds(), Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn export_setup(contents: String) -> Result<bool, String> {
    if contents.len() > 1_000_000 {
        return Err("Setup too large".into());
    }
    let file = rfd::AsyncFileDialog::new()
        .set_file_name("quota-otter-setup.json")
        .add_filter("JSON", &["json"])
        .save_file()
        .await;
    if let Some(file) = file {
        file.write(contents.as_bytes())
            .await
            .map_err(|_| "Could not save setup")?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn import_setup() -> Result<Option<String>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("JSON", &["json"])
        .pick_file()
        .await;
    if let Some(file) = file {
        let len = std::fs::metadata(file.path())
            .map_err(|_| "Could not read setup")?
            .len();
        if len > 1_000_000 {
            return Err("Setup too large".into());
        }
        String::from_utf8(file.read().await)
            .map(Some)
            .map_err(|_| "Setup is not UTF-8".into())
    } else {
        Ok(None)
    }
}

fn shell_path(path: &std::path::Path) -> Result<String, String> {
    let p = path.to_str().ok_or("Path is not valid UTF-8")?;
    if p.contains(['\r', '\n']) {
        return Err("Unsupported newline in application path".into());
    }
    #[cfg(windows)]
    {
        if p.contains(['"', '%', '!']) {
            return Err("Unsupported shell character in application path".into());
        }
        Ok(format!("\"{}\"", p))
    }
    #[cfg(not(windows))]
    {
        Ok(format!("'{}'", p.replace('\'', "'\"'\"'")))
    }
}

#[tauri::command]
fn prepare_claude_bridge(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    codex::validate_id(&id)?;
    let root = data_dir(&app)?.join("claude-feeds").join(&id);
    std::fs::create_dir_all(&root).map_err(|_| "Could not create feed directory")?;
    let script = root.join("statusline.mjs");
    let output = root.join("usage.json");
    let settings = root.join("settings.json");
    let command = format!(
        "node {} --output {}",
        shell_path(&script)?,
        shell_path(&output)?
    );
    let config = json!({"statusLine":{"type":"command","command":command}});
    std::fs::write(&script, include_str!("../../scripts/claude-statusline.mjs"))
        .map_err(|_| "Could not write feed helper")?;
    std::fs::write(
        &settings,
        serde_json::to_vec_pretty(&config).map_err(|_| "Could not encode feed settings")?,
    )
    .map_err(|_| "Could not save feed settings")?;
    Ok(json!({"command":format!("claude --settings {}",shell_path(&settings)?),"settings":config}))
}

#[tauri::command]
fn read_claude_usage(app: tauri::AppHandle, id: String) -> Result<Option<Value>, String> {
    codex::validate_id(&id)?;
    let file = data_dir(&app)?
        .join("claude-feeds")
        .join(id)
        .join("usage.json");
    if !file.exists() {
        return Ok(None);
    }
    if std::fs::metadata(&file)
        .map_err(|_| "Could not read Claude feed")?
        .len()
        > 32_000
    {
        return Err("Claude feed is too large".into());
    }
    let content = std::fs::read(file).map_err(|_| "Could not read Claude feed")?;
    let data: Value = serde_json::from_slice(&content).map_err(|_| "Invalid Claude feed")?;
    // Project fields explicitly so even a modified local file cannot inject secrets.
    Ok(Some(
        json!({"version":data.get("version"),"observedAt":data.get("observedAt"),"rate_limits":data.get("rate_limits")}),
    ))
}

#[tauri::command]
fn remove_claude_feed(app: tauri::AppHandle, id: String) -> Result<(), String> {
    codex::validate_id(&id)?;
    let path = data_dir(&app)?.join("claude-feeds").join(id);
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|_| "Could not remove Claude feed")?;
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Connections::default())
        .invoke_handler(tauri::generate_handler![
            begin_login,
            cancel_login,
            read_usage,
            disconnect,
            update_tray,
            export_setup,
            import_setup,
            prepare_claude_bridge,
            read_claude_usage,
            remove_claude_feed
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Quota Otter", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("quota")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/32x32.png"
                ))?)
                .tooltip("Quota Otter · usage not yet refreshed")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "refresh" => {
                        let _ = app.emit("refresh-requested", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    ticker.tick().await;
                    if epoch_seconds().saturating_sub(LAST_TRAY_UPDATE.load(Ordering::Relaxed))
                        > 180
                    {
                        let _ = update_tray(
                            handle.clone(),
                            "OA ? · CL ?".into(),
                            "Usage is stale. Open Quota Otter to refresh.".into(),
                        );
                    }
                    let _ = handle.emit("refresh-requested", ());
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // If the tray couldn't be created setup fails; never hide without a way back.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start Quota Otter");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Explicitly drop subprocess handles before the async runtime terminates.
            tauri::async_runtime::block_on(async {
                handle.state::<Connections>().0.lock().await.clear();
            });
        }
    });
}
