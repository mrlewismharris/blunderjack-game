#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn main() {
    if let Err(error) = run() {
        let caption: Vec<u16> = "BlunderJack\0".encode_utf16().collect();
        let message: Vec<u16> = format!("The game window could not open.\n\n{error}\0")
            .encode_utf16()
            .collect();
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MessageBoxW};
        // Both UTF-16 buffers are NUL-terminated and live through the call.
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                caption.as_ptr(),
                MB_ICONERROR,
            )
        };
        std::process::exit(1);
    }
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn run() -> Result<(), Box<dyn std::error::Error>> {
    use blunderjack::client_assets;
    use std::{borrow::Cow, path::PathBuf};
    use tao::{
        dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
        window::WindowBuilder,
    };
    #[cfg(windows)]
    use wry::WebViewBuilderExtWindows;
    use wry::{WebContext, WebViewBuilder, http::Response};

    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(format!("BlunderJack {}", blunderjack::GAME_VERSION))
        .with_inner_size(PhysicalSize::new(1600, 850))
        .with_min_inner_size(LogicalSize::new(680, 480))
        .with_visible(false)
        .build(&event_loop)?;

    if let Some(monitor) = window.current_monitor() {
        let size = window.outer_size();
        let area = monitor.size();
        let origin = monitor.position();
        window.set_outer_position(PhysicalPosition::new(
            origin.x + (area.width.saturating_sub(size.width) / 2) as i32,
            origin.y + (area.height.saturating_sub(size.height) / 2) as i32,
        ));
    }

    #[cfg(windows)]
    let profile_directory = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|directory| {
            let legacy = directory.join("BlackjackCardGame").join("WebView");
            if legacy.exists() {
                legacy
            } else {
                directory.join("BlunderJack").join("WebView")
            }
        });
    #[cfg(target_os = "linux")]
    let profile_directory = std::env::var_os("XDG_DATA_HOME")
        .filter(|path| PathBuf::from(path).is_absolute())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .map(|directory| directory.join("BlunderJack").join("WebView"));
    // WKWebView manages its own persistent data store on macOS.
    #[cfg(target_os = "macos")]
    let profile_directory: Option<PathBuf> = None;
    let mut context = WebContext::new(profile_directory);
    let builder =
        WebViewBuilder::new_with_web_context(&mut context).with_background_color((0, 0, 0, 255));
    #[cfg(windows)]
    let builder = builder.with_browser_accelerator_keys(false);
    let builder = builder
        // Retain the original origin so saved client credentials remain available.
        .with_custom_protocol("blackjack".into(), |_, request| {
            let path = request.uri().path();
            let Some((content_type, contents)) = client_assets::get(path) else {
                return Response::builder()
                    .status(404)
                    .body(Cow::Borrowed(b"Not found".as_slice()))
                    .expect("static error response is valid");
            };
            Response::builder()
                .header("Content-Type", content_type)
                .header(
                    "Content-Security-Policy",
                    client_assets::CONTENT_SECURITY_POLICY,
                )
                .header("X-Content-Type-Options", "nosniff")
                .body(Cow::Borrowed(contents))
                .expect("embedded asset response is valid")
        })
        .with_navigation_handler(|url| {
            url.starts_with("http://blackjack.localhost/")
                || url.starts_with("blackjack://localhost/")
        })
        .with_url("blackjack://localhost/");
    #[cfg(any(windows, target_os = "macos"))]
    let webview = builder.build(&window)?;
    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window
            .default_vbox()
            .ok_or("GTK window container unavailable")?;
        builder.build_gtk(vbox)?
    };
    window.set_visible(true);

    event_loop.run(move |event, _, control_flow| {
        let _keep_alive = (&window, &webview, &context);
        *control_flow = ControlFlow::Wait;
        if matches!(
            event,
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            }
        ) {
            *control_flow = ControlFlow::Exit;
        }
    });
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn main() {
    if let Err(error) = run() {
        eprintln!("The game window could not open: {error}");
        std::process::exit(1);
    }
}
