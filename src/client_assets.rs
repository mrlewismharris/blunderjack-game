pub const CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self'; ",
    "connect-src 'self' ws: wss:; ",
    "style-src 'self' 'unsafe-inline'; ",
    "img-src 'self' data:; ",
    "media-src 'self' blob:; ",
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
);

macro_rules! tracks {
    ($(($title:literal, $duration_ms:literal),)*) => {
        const AUDIO: &[&[u8]] = &[
            $(include_bytes!(concat!("../client/music/", $title, ".opus")),)*
        ];
    };
}
crate::music_catalog!(tracks);

fn music_asset(path: &str) -> Option<(&'static str, &'static [u8])> {
    let id = path.strip_prefix("/music/")?.strip_suffix(".opus")?;
    let index = id.parse::<usize>().ok()?;
    Some(("audio/ogg", *AUDIO.get(index)?))
}

pub fn get(path: &str) -> Option<(&'static str, &'static [u8])> {
    match path {
        "/" | "/index.html" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../client/index.html"),
        )),
        "/styles.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../client/styles.css"),
        )),
        "/version.js" => Some((
            "text/javascript; charset=utf-8",
            concat!(
                "window.BLUNDERJACK_VERSION = \"v",
                env!("CARGO_PKG_VERSION"),
                "\";"
            )
            .as_bytes(),
        )),
        "/game.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../client/game.js"),
        )),
        "/table.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../client/table.js"),
        )),
        "/music.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../client/music.js"),
        )),
        "/music-playlist.js" => {
            static PLAYLIST: std::sync::OnceLock<String> = std::sync::OnceLock::new();
            let script = PLAYLIST.get_or_init(|| {
                format!(
                    "window.BLUNDERJACK_PLAYLIST = {};",
                    serde_json::json!(crate::music_catalog::TRACKS)
                )
            });
            Some(("text/javascript; charset=utf-8", script.as_bytes()))
        }
        "/cards/jack.png" => Some(("image/png", include_bytes!("../client/cards/jack.png"))),
        "/cards/queen.png" => Some(("image/png", include_bytes!("../client/cards/queen.png"))),
        "/cards/king.png" => Some(("image/png", include_bytes!("../client/cards/king.png"))),
        "/cards/jack-red.png" => {
            Some(("image/png", include_bytes!("../client/cards/jack-red.png")))
        }
        "/cards/queen-red.png" => {
            Some(("image/png", include_bytes!("../client/cards/queen-red.png")))
        }
        "/cards/king-red.png" => {
            Some(("image/png", include_bytes!("../client/cards/king-red.png")))
        }
        "/vendor/three.module.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../client/vendor/three.module.js"),
        )),
        "/vendor/three.core.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../client/vendor/three.core.js"),
        )),
        "/vendor/THREE-LICENSE.txt" => Some((
            "text/plain; charset=utf-8",
            include_bytes!("../client/vendor/THREE-LICENSE.txt"),
        )),
        _ => music_asset(path),
    }
}
