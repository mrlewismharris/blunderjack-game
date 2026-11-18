use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

pub(super) struct GameResult {
    pub key: String,
    pub name: String,
    pub style: Option<String>,
    /// Zero-based finishing position; None means outside the podium.
    pub place: Option<usize>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Record {
    name: String,
    games: u64,
    first: u64,
    second: u64,
    third: u64,
    losses: u64,
}

impl Record {
    fn add(&mut self, place: Option<usize>) {
        self.games += 1;
        match place {
            Some(0) => self.first += 1,
            Some(1) => self.second += 1,
            Some(2) => self.third += 1,
            _ => self.losses += 1,
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Data {
    games: u64,
    analysis_games: u64,
    participants: BTreeMap<String, Record>,
    normal_styles: BTreeMap<String, Record>,
    analysis_styles: BTreeMap<String, Record>,
}

pub(super) struct Stats {
    path: PathBuf,
    data: Data,
}

impl Stats {
    pub(super) fn load(path: PathBuf) -> io::Result<Self> {
        let data = match fs::read(&path) {
            Ok(contents) => serde_json::from_slice(&contents)
                .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?,
            Err(err) if err.kind() == io::ErrorKind::NotFound => Data::default(),
            Err(err) => return Err(err),
        };
        Ok(Self { path, data })
    }

    pub(super) fn record_game(&mut self, results: &[GameResult], analysis: bool) -> io::Result<()> {
        self.data.games += 1;
        if analysis {
            self.data.analysis_games += 1;
        }
        for result in results {
            let participant = self
                .data
                .participants
                .entry(result.key.clone())
                .or_default();
            participant.name.clone_from(&result.name);
            participant.add(result.place);
            if let Some(style) = &result.style {
                let styles = if analysis {
                    &mut self.data.analysis_styles
                } else {
                    &mut self.data.normal_styles
                };
                styles.entry(style.clone()).or_default().add(result.place);
            }
        }
        self.save()
    }

    pub(super) fn save(&self) -> io::Result<()> {
        let (temp_path, mut file) = loop {
            let mut name = self.path.as_os_str().to_os_string();
            name.push(format!(".{}.tmp", rand::random::<u64>()));
            let temp_path = PathBuf::from(name);
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)
            {
                Ok(file) => break (temp_path, file),
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            }
        };
        let result = (|| {
            serde_json::to_writer_pretty(&mut file, &self.data).map_err(io::Error::other)?;
            writeln!(file)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp_path, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp_path);
        }
        result
    }

    pub(super) fn counts(&self, key: &str) -> Option<(u64, u64, u64, u64)> {
        self.data
            .participants
            .get(key)
            .map(|r| (r.games, r.first, r.second, r.third))
    }

    pub(super) fn overview(&self) -> String {
        let mut text = format!(
            "Cumulative stats: {} completed games ({} analysis)\n",
            self.data.games, self.data.analysis_games
        );
        Self::style_overview(&mut text, "Normal bot styles", &self.data.normal_styles);
        Self::style_overview(&mut text, "Analysis bot styles", &self.data.analysis_styles);
        text.push_str("Players and bots (all games):\n");
        if self.data.participants.is_empty() {
            text.push_str("  No results yet.\n");
        }
        for record in self.data.participants.values() {
            text.push_str(&format!(
                "  {}: {} appearances, 1st {}, 2nd {}, 3rd {}, losses {}\n",
                record.name, record.games, record.first, record.second, record.third, record.losses
            ));
        }
        text.trim_end().to_owned()
    }

    fn style_overview(text: &mut String, label: &str, styles: &BTreeMap<String, Record>) {
        text.push_str(&format!("{label}:\n"));
        if styles.is_empty() {
            text.push_str("  No results yet.\n");
        }
        let mut rows: Vec<_> = styles.iter().collect();
        rows.sort_by(|(a_name, a), (b_name, b)| {
            let rate = |r: &Record, n: u64| {
                if r.games == 0 {
                    0.0
                } else {
                    n as f64 / r.games as f64
                }
            };
            rate(b, b.first)
                .total_cmp(&rate(a, a.first))
                .then_with(|| {
                    rate(b, b.first + b.second + b.third)
                        .total_cmp(&rate(a, a.first + a.second + a.third))
                })
                .then_with(|| a_name.cmp(b_name))
        });
        for (name, r) in rows {
            let pct = |n: u64| {
                if r.games == 0 {
                    0.0
                } else {
                    100.0 * n as f64 / r.games as f64
                }
            };
            text.push_str(&format!("  {}: {} appearances, wins {}/{} ({:.1}%), podiums {}/{} ({:.1}%), 1st {}, 2nd {}, 3rd {}, losses {}\n", name, r.games, r.first, r.games, pct(r.first), r.first + r.second + r.third, r.games, pct(r.first + r.second + r.third), r.first, r.second, r.third, r.losses));
        }
    }
}
