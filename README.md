# BlunderJack

A multiplayer shedding game for 2–10 players. The desktop client opens in a resizable window, with a preferred client area of 1600 × 850. Windows, macOS and Linux builds include both the client and server. The server also hosts a browser client at its HTTP address.

## Play on Windows

1. Extract the Windows x64 release into a folder. Keep `WebView2Loader.dll` alongside `blunderjack-client.exe`. The desktop client uses the Microsoft Edge WebView2 Runtime.
2. On the host computer, run `blunderjack-server.exe`. It listens on TCP port `8765` by default. Keep the server running while you play.
3. Each player opens `blunderjack-client.exe`, creates a character, and chooses **Join a table**. Enter the host’s LAN IP, or enter `127.0.0.1` on the host computer. To use the browser client, open `http://<host-IP>:8765`.
4. Choose an open seat. Once at least two players are seated, type `game_start` and press Enter in the server console to deal immediately. The lobby waits for this command when the server first opens.

The Windows client includes the soundtrack in its executable, and the server serves the same tracks to the browser client. Bluebird opens the menu playlist, and Topless opens the server playlist. Both shuffle after each full rotation, keeping the previous rotation's last three tracks out of the next rotation's first three. Use the player in the top-right corner to skip or pause tracks in the menu. At the table the soundtrack follows the server's playlist clock. Click the speaker to mute, or hover over it to adjust your own volume. If your browser blocks autoplay, click the page or press Play in the music player.

## Play on macOS and Linux

Extract the archive for your platform. Start `./blunderjack-server` in one terminal and `./blunderjack-client` in another. On macOS, choose the ARM64 archive for Apple Silicon or x64 for Intel. These initial macOS executables are unsigned and are launched from a terminal.

On Ubuntu 22.04 or newer, install the desktop runtime packages with `sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libxdo3 gstreamer1.0-plugins-base gstreamer1.0-plugins-good`. The server can also be used with your web browser at `http://127.0.0.1:8765`.

## Hosting a table

Type `game_restart` in the server console to end the current round and deal a fresh hand immediately to the connected players in their seats. This also requires at least two players. Between completed rounds, the usual five-second countdown applies. A player taking a seat during a round watches until the next deal.

The server console shows connections, seat changes, turns, plays, draw counts, BLUNDER calls and rulings, and round results.

Type `password_set "your password"` in the server console to require a password for new connections and reconnects. Type `password_set ""` to remove it. Players already connected can keep playing. The password lasts until the server restarts. Use `wss://` if the password needs to be encrypted in transit.

Hold `Tab` at the table to see first-, second- and third-place finishes, losses, and estimated one-way ping. A round continues until the podium is decided. If only one player remains, they take the next available place. Scores last for the server session. Ping is half the server’s measured round-trip time.

### Console pranks

Type `prank_help` to list the commands. Pass a seated player's name in quotes, as in `grow_head "John Smith"`, or use their seat number, as in `grow_head #3`. Everyone at the table sees the effect for a few seconds.

| Command | Effect |
| --- | --- |
| `grow_head` | Inflates the player's head, then shrinks it back. |
| `tiny_head` | Shrinks the player's head. |
| `spin_chair` | Spins the player and chair together. |
| `bounce` | Makes the player bounce in their seat. |
| `disco` | Cycles through sweater colours. |
| `pancake` | Squashes the player flat and wide. |
| `bomb` | Sends a cartoon plane over the table to drop a mushroom cloud on the target. |
| `teabag #1 #3` | Makes the first player hop around the table, bounce on the second player's head, and return to their chair. |

Use **Activity and Chat** to talk to everyone at the table. Type `/prank_help` to see the available chat commands. Commands like `/grow_head` affect your character. Use `/bomb #3` or `/teabag #3` to target another player by the seat number beside their name.

### Chat administration

1. Connect over localhost, or use a `wss://` connection for remote administration. In a remote browser, open the game over HTTPS as well.
2. Type `/id` in chat to get your verified client ID. The server console also prints it at join. The ID persists in the client profile for that server address.
3. In the server console, run `admin_add <client ID>`. Use `admin_list` to list administrators and `admin_remove <client ID>` to revoke access. The server saves these IDs in `blunderjack-admins-<port>.txt` in its working directory.

Admins can use `/game_start`, `/game_restart`, or `/password_set "password"` directly in chat. Run any other game console command with `/admin`, for example `/admin grow_head #3`. Replies appear only in your own activity log. Plain remote WebSocket connections receive an unverified player ID and can use regular chat and pranks.

Drag the table to orbit, middle-drag to pan, and scroll to zoom. The camera follows the active player by default. Use **Centre Camera** to see the whole table or turn **Follow** off to keep your own angle. Drag the floating controls by their handle to move them, and press `Esc` to open the table menu. When the table has keyboard focus, use the arrow keys to look around, `+` and `-` to zoom, and `Home` to centre the camera.

While seated, choose **First Person** to see your cards fanned out in front of you. With **Follow** on, the camera turns toward the active player from your seat and looks toward the table on your turn. Set the field of view in **Options** and hold `Shift` to zoom in. Other players can see your character turn as you look around. Choose **Look** and click another player to face them for five seconds. Press `Ctrl+Shift+E` to pick an emoji to show above your character. Drag the handle under a card to reorder your hand.

For a local two-player test, open `blunderjack-client.exe` twice and join `127.0.0.1` in each window. You can also join from a browser at `http://127.0.0.1:8765`.

To listen on a different address or port, pass it to the server, for example `blunderjack-server.exe 127.0.0.1:9000`. Players then enter `127.0.0.1:9000`.

The server shuffles and deals the cards, accepts plays only from the current player, and sends each hand only to its owner. Direct IP connections use plain WebSocket. For encrypted connections, put the server behind a TLS reverse proxy that forwards `/ws` and enter the proxy’s `https://` or `wss://` address in the client.

## Rules at the table

- Each player starts with seven cards. The table uses two decks for 2–4 players, three for 5–7, and four for 8–10. The dealer moves clockwise each round. The first player is the next occupied seat clockwise from the dealer.
- Match the POT by suit or rank, or lead with an Ace. The Ace displays as 1. The illustrated Jack, Queen, and King count as 11, 12, and 13. Within a chain, match rank to change suits or move one rank up or down in the same suit. An Ace inside the chain must match suit. The card after an Ace in the same chain must be a King or 2 of its suit.
- Only the last card activates a special effect. Count consecutive matching special cards at the end for 2s, Queens, or black Jacks. An 8 reverses direction. Queens skip one turn each. Each 2 adds two cards to the pending pickup, which the next player can pass on by playing more 2s. A new black-Jack penalty starts at seven per black Jack. A black Jack played in response doubles the outstanding amount per card. A single red Jack cancels the entire black-Jack penalty.
- Drawing ends the turn. If the PICKUP empties, the older POT cards become the new PICKUP in the same order, with the current top card left in place. A player who fails to reconnect within 20 seconds returns their hand to the bottom of the PICKUP.
- Drag or use the arrows to reorder your hand or staged play. Click cards to select them, then click **Play Hand (Space)** or press Space. Other players see the cards go onto the POT in order.
- Another player in the round can call **BLUNDER** once before the next turn is taken. The table pauses briefly for the ruling. If the play was illegal, the offender takes back the cards and draws two. If the play was legal, the caller draws two. Unchallenged illegal plays stand. A finishing play must be legal and has an eight-second challenge window after its reveal.
- When you play down to one card, click **Last Card** before someone places another card or calls **BLUNDER**. If a legal play is challenged and you missed the call, take back the last card you placed and draw one. If you called it, the challenger draws one. An unchallenged missed call carries no penalty.

## Build from source

Use Rust stable. Windows builds require the MSVC C++ build tools, macOS builds require the Xcode command line tools, and Linux builds require `libgtk-3-dev libwebkit2gtk-4.1-dev libxdo-dev` and the GStreamer runtime plugins listed above. Run the following from the project directory.

```powershell
cargo build --release --locked --bins
cargo test --locked
```

The executables are in `target/release`. To run from Cargo, use `cargo run --bin blunderjack-server` and `cargo run --bin blunderjack-client` in separate terminals. With the Windows GNU toolchain, have MinGW `dlltool` and `as` on `PATH`. When distributing a GNU desktop build, copy the matching `WebView2Loader.dll` from the `webview2-com-sys` build output to the client executable’s folder.

The Three.js runtime and its MIT license are vendored under `client/vendor`.

The Jack, Queen, and King use original monochrome pictograms. See `client/cards/ARTWORK-LICENSE.txt`.
