use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::PathBuf,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct Identity {
    pub(super) id: String,
    pub(super) verified: bool,
}

/// Accept the conventional hyphenated UUID representation, in either case.
pub(super) fn normalize_id(id: &str) -> Option<String> {
    let bytes = id.as_bytes();
    if bytes.len() != 36
        || !bytes.iter().enumerate().all(|(i, c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    {
        return None;
    }
    Some(id.to_ascii_lowercase())
}

pub(super) fn join_identity(value: &serde_json::Value) -> Result<Option<Identity>, &'static str> {
    let object = value.as_object().ok_or("invalid join message")?;
    let client_id = match object.get("clientId") {
        Some(value) => Some(
            normalize_id(value.as_str().ok_or("invalid clientId")?).ok_or("invalid clientId")?,
        ),
        None => None,
    };
    if let Some(value) = object.get("identityKey") {
        let key = value.as_str().ok_or("invalid identityKey")?;
        if key.len() != 64 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("invalid identityKey");
        }
        let mut raw = [0u8; 32];
        for (i, pair) in key.as_bytes().chunks_exact(2).enumerate() {
            let digit = |c: u8| -> u8 {
                match c.to_ascii_lowercase() {
                    b'0'..=b'9' => c - b'0',
                    c => c - b'a' + 10,
                }
            };
            raw[i] = digit(pair[0]) * 16 + digit(pair[1]);
        }
        let digest = Sha256::digest(raw);
        let mut bytes = [0u8; 16];
        bytes.copy_from_slice(&digest[..16]);
        bytes[6] = (bytes[6] & 0x0f) | 0x80;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let id = format!(
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            bytes[0],
            bytes[1],
            bytes[2],
            bytes[3],
            bytes[4],
            bytes[5],
            bytes[6],
            bytes[7],
            bytes[8],
            bytes[9],
            bytes[10],
            bytes[11],
            bytes[12],
            bytes[13],
            bytes[14],
            bytes[15]
        );
        Ok(Some(Identity { id, verified: true }))
    } else {
        Ok(client_id.map(|id| Identity {
            id,
            verified: false,
        }))
    }
}

pub(super) struct Admins {
    path: PathBuf,
    ids: BTreeSet<String>,
}

impl Admins {
    pub(super) fn load(path: PathBuf) -> io::Result<Self> {
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(err) if err.kind() == io::ErrorKind::NotFound => String::new(),
            Err(err) => return Err(err),
        };
        let mut ids = BTreeSet::new();
        for line in contents.lines() {
            let line = line.trim();
            if !line.is_empty() {
                ids.insert(normalize_id(line).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "invalid administrator ID")
                })?);
            }
        }
        Ok(Self { path, ids })
    }

    pub(super) fn contains(&self, id: &str) -> bool {
        self.ids.contains(id)
    }

    pub(super) fn list(&self) -> impl Iterator<Item = &str> {
        self.ids.iter().map(String::as_str)
    }

    pub(super) fn set(&mut self, id: &str, enabled: bool) -> io::Result<bool> {
        let id = normalize_id(id).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "invalid administrator ID")
        })?;
        let mut ids = self.ids.clone();
        let changed = if enabled {
            ids.insert(id)
        } else {
            ids.remove(&id)
        };
        if !changed {
            return Ok(false);
        }
        // A uniquely named sibling keeps the final rename on the same filesystem.
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
            for id in &ids {
                writeln!(file, "{id}")?;
            }
            file.sync_all()?;
            drop(file);
            fs::rename(&temp_path, &self.path)
        })();
        if let Err(err) = result {
            let _ = fs::remove_file(temp_path);
            return Err(err);
        }
        self.ids = ids;
        Ok(true)
    }
}
