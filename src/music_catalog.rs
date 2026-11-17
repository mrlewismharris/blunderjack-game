// The list position is the stable asset ID. Durations exclude Opus pre-skip.
#[macro_export]
macro_rules! music_catalog {
    ($callback:ident) => {
        $callback! {
            ("Bluebird", 140_439),
            ("Convenience Store", 143_667),
            ("Girl in a Sportscar", 162_869),
            ("Lady Blue", 172_812),
            ("Ladybird", 267_384),
            ("Larissa", 189_372),
            ("Nobody", 180_999),
            ("Relax", 164_693),
            ("Rise and Shine", 155_680),
            ("So the Lovers Say", 140_866),
            ("Tengo Ritmo", 147_201),
            ("Topless", 138_859),
            ("Under the Marquee", 128_592),
        }
    };
}

macro_rules! metadata {
    ($(($title:literal, $duration_ms:literal),)*) => {
        pub const TRACKS: &[(&str, u32)] = &[$(($title, $duration_ms),)*];
    };
}
music_catalog!(metadata);
