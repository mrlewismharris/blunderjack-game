const music = (() => {
  const playlist = window.BLUNDERJACK_PLAYLIST;
  if (!playlist?.length) return null;

  const player = document.getElementById("music-player");
  const titleClip = document.getElementById("music-title-clip");
  const title = document.getElementById("music-title");
  const syncStatus = document.getElementById("music-sync-status");
  const play = document.getElementById("music-play");
  const mute = document.getElementById("music-mute");
  const volume = document.getElementById("music-volume");
  const audio = new Audio();
  player.append(audio);

  const totalMs = playlist.reduce((sum, [, duration]) => sum + duration, 0);
  const trackIds = playlist.map((_, index) => index);
  const bluebird = playlist.findIndex(([name]) => name === "Bluebird");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let titleAnimation;
  let fadeLevel = 1;
  let sourceUrl;
  let sourceIndex = -1;
  let trackIndex = 0;
  let transition;
  const menuOrder = [
    bluebird,
    ...shuffle(trackIds.filter((id) => id !== bluebird)),
  ];
  let menuSlot = 0;
  let menuPosition = 0;
  let menuPaused = false;
  let serverClock;
  let boundaryTimer;
  let clockInterval;
  let requestId = 0;
  let clockRequest;
  let syncNoticePending = false;
  let userMuted = localStorage.getItem("bj-music-muted") === "true";
  let audioContext;
  let gain;

  // Media element volume is fixed on some mobile browsers. Route through Web
  // Audio where available, and retain the element's mute as a zero fallback.
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioContext = new AudioContext();
      gain = audioContext.createGain();
      audioContext.createMediaElementSource(audio).connect(gain);
      gain.connect(audioContext.destination);
    }
  } catch (error) {
    console.warn("Could not initialize soundtrack volume control", error);
    gain = undefined;
  }

  function resumeAudioContext() {
    if (audioContext?.state === "suspended")
      audioContext.resume().catch(() => {});
  }
  // A browser may suspend Web Audio even when media autoplay is permitted.
  document.addEventListener("click", resumeAudioContext, { capture: true });
  document.addEventListener("touchstart", resumeAudioContext, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", resumeAudioContext, { capture: true });

  volume.value = localStorage.getItem("bj-music-volume") ?? 0.35;

  function applyVolume() {
    const setting = Math.max(0, Math.min(1, Number(volume.value) || 0));
    volume.style.setProperty("--volume-fill", `${setting * 100}%`);
    const level = userMuted ? 0 : 0.25 * setting ** 2 * fadeLevel;
    audio.muted = level === 0;
    if (gain) {
      audio.volume = 1;
      gain.gain.value = level;
    } else {
      audio.volume = level;
    }
  }

  function updateMuteButton() {
    mute.setAttribute("aria-pressed", String(userMuted));
    mute.setAttribute("aria-label", userMuted ? "Unmute music" : "Mute music");
  }

  volume.oninput = () => {
    localStorage.setItem("bj-music-volume", volume.value);
    if (userMuted && Number(volume.value) > 0) {
      userMuted = false;
      localStorage.setItem("bj-music-muted", "false");
      updateMuteButton();
    }
    applyVolume();
  };
  mute.onclick = () => {
    userMuted = !userMuted;
    localStorage.setItem("bj-music-muted", String(userMuted));
    applyVolume();
    updateMuteButton();
  };

  function scrollTitle() {
    titleAnimation?.cancel();
    const overflow = title.offsetWidth - titleClip.clientWidth;
    if (overflow <= 0 || !titleClip.clientWidth || motion.matches) return;

    const travel = (overflow / 30) * 1_000;
    const end = 1_000 + travel;
    const duration = end + 1_400;
    const startPosition = "translateX(0)";
    const endPosition = `translateX(-${overflow}px)`;
    titleAnimation = title.animate(
      [
        { transform: startPosition, opacity: 1, offset: 0 },
        { transform: startPosition, opacity: 1, offset: 1_000 / duration },
        { transform: endPosition, opacity: 1, offset: end / duration },
        {
          transform: endPosition,
          opacity: 1,
          offset: (end + 1_000) / duration,
        },
        {
          transform: endPosition,
          opacity: 0,
          offset: (end + 1_200) / duration,
        },
        {
          transform: startPosition,
          opacity: 0,
          offset: (end + 1_200) / duration,
        },
        { transform: startPosition, opacity: 1, offset: 1 },
      ],
      { duration, iterations: Infinity, easing: "linear" },
    );
  }

  function updatePlayButton() {
    play.setAttribute("aria-pressed", String(!audio.paused));
    play.setAttribute(
      "aria-label",
      audio.paused ? "Play music" : "Pause music",
    );
  }
  audio.addEventListener("play", updatePlayButton);
  audio.addEventListener("pause", updatePlayButton);

  async function startPlayback() {
    resumeAudioContext();
    try {
      await audio.play();
    } catch (error) {
      if (error.name !== "NotAllowedError") throw error;
      player.classList.add("music-needs-play");
      return false;
    }
    player.classList.remove("music-needs-play");
    return true;
  }

  function resumePlayback() {
    startPlayback().then((started) => {
      if (started) showSyncNotice();
    }, updatePlayButton);
  }

  document.addEventListener(
    "click",
    (event) => {
      if (
        !player.classList.contains("music-needs-play") ||
        event.target.closest("#music-player")
      )
        return;
      if (serverClock) synchronize();
      else if (!menuPaused) resumePlayback();
    },
    { capture: true },
  );

  function shuffle(order) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  function showSyncNotice() {
    if (!syncNoticePending || !serverClock) return;
    syncNoticePending = false;
    syncStatus.classList.remove("music-sync-visible");
    void syncStatus.offsetWidth;
    syncStatus.classList.add("music-sync-visible");
  }

  function fadeTo(level, duration, signal) {
    const start = performance.now();
    const from = fadeLevel;
    return new Promise((resolve) => {
      function step() {
        if (signal.aborted) return resolve();
        const progress = Math.min(1, (performance.now() - start) / duration);
        fadeLevel = from + (level - from) * progress;
        applyVolume();
        if (progress < 1) setTimeout(step, 16);
        else resolve();
      }
      step();
    });
  }

  async function loadTrack(index, signal) {
    if (index !== sourceIndex || audio.error) {
      const response = await fetch(`/music/${index}.opus`, { signal });
      if (!response.ok)
        throw new Error(`Music track unavailable (${response.status})`);
      const bytes = await response.blob();
      signal.throwIfAborted();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      sourceUrl = URL.createObjectURL(bytes);
      sourceIndex = index;
      audio.src = sourceUrl;
    }
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    await new Promise((resolve, reject) => {
      audio.addEventListener("loadedmetadata", resolve, { once: true, signal });
      audio.addEventListener("error", () => reject(audio.error), {
        once: true,
        signal,
      });
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  }

  async function changeTrack(index, position, fade = false) {
    transition?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    transition = controller;
    trackIndex = index;

    try {
      if (fade && !audio.paused) await fadeTo(0, 180, signal);
      signal.throwIfAborted();
      audio.pause();
      title.textContent = playlist[index][0];
      titleClip.title = title.textContent;
      scrollTitle();
      fadeLevel = fade ? 0 : 1;
      applyVolume();
      await loadTrack(index, signal);
      signal.throwIfAborted();
      audio.currentTime = Math.min(
        position(),
        Math.max(0, audio.duration - 0.001),
      );
      if ((serverClock || !menuPaused) && (await startPlayback())) {
        if (fade) await fadeTo(1, 260, signal);
        if (!signal.aborted) showSyncNotice();
      } else {
        fadeLevel = 1;
        applyVolume();
      }
    } catch (error) {
      if (!signal.aborted) {
        console.warn("Could not play soundtrack", error);
        fadeLevel = 1;
        applyVolume();
        updatePlayButton();
      }
    } finally {
      if (transition === controller) transition = undefined;
    }
  }

  function skip(step) {
    if (serverClock || menuSlot + step < 0) return;
    menuSlot += step;
    if (menuSlot === menuOrder.length) {
      const tail = menuOrder.slice(-3);
      const opening = shuffle(
        trackIds.filter((id) => !tail.includes(id)),
      ).slice(0, 3);
      const rest = shuffle(trackIds.filter((id) => !opening.includes(id)));
      menuOrder.push(...opening, ...rest);
    }
    menuPosition = 0;
    changeTrack(menuOrder[menuSlot], () => 0);
  }
  document.getElementById("music-previous").onclick = () => skip(-1);
  document.getElementById("music-next").onclick = () => skip(1);
  play.onclick = () => {
    if (serverClock) {
      if (player.classList.contains("music-needs-play")) synchronize();
      return;
    }
    const menuIndex = menuOrder[menuSlot];
    menuPaused = !audio.paused;
    if (menuPaused) audio.pause();
    else if (
      !audio.error &&
      sourceIndex === menuIndex &&
      audio.readyState >= HTMLMediaElement.HAVE_METADATA
    )
      resumePlayback();
    else if (!transition) {
      changeTrack(menuIndex, () => 0);
    }
  };

  function serverPosition() {
    let elapsed =
      (serverClock.elapsed % totalMs) + performance.now() - serverClock.at;
    const order = elapsed < totalMs ? serverClock.order : serverClock.nextOrder;
    elapsed %= totalMs;
    for (const index of order) {
      const duration = playlist[index][1];
      if (elapsed < duration)
        return { index, elapsed, remaining: duration - elapsed };
      elapsed -= duration;
    }
  }

  function synchronize(fade = false) {
    if (!serverClock) return;
    const { index, elapsed, remaining } = serverPosition();
    clearTimeout(boundaryTimer);
    boundaryTimer = setTimeout(synchronize, remaining + 15);
    if (
      fade ||
      index !== trackIndex ||
      (!transition && (sourceIndex !== index || audio.error))
    ) {
      changeTrack(
        index,
        () => {
          const position = serverPosition();
          return position.index === index ? position.elapsed / 1_000 : 0;
        },
        fade,
      );
    } else if (
      !transition &&
      audio.readyState >= HTMLMediaElement.HAVE_METADATA
    ) {
      if (Math.abs(audio.currentTime - elapsed / 1_000) > 0.2)
        audio.currentTime = elapsed / 1_000;
      if (!audio.paused) showSyncNotice();
      else if (!audio.ended) resumePlayback();
    }
  }

  audio.addEventListener("ended", () => {
    if (serverClock) synchronize();
    else if (!transition) skip(1);
  });

  function validOrder(order) {
    return (
      Array.isArray(order) &&
      order.length === trackIds.length &&
      new Set(order).size === trackIds.length &&
      order.every((id) => trackIds.includes(id))
    );
  }

  function readClock(message, at) {
    const {
      musicElapsedMs: elapsed,
      musicOrder: order = trackIds,
      musicNextOrder: nextOrder = trackIds,
    } = message;
    if (
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      !validOrder(order) ||
      !validOrder(nextOrder)
    )
      return;
    return { elapsed, order, nextOrder, at };
  }

  function connect(message, request) {
    const sampleClock = readClock(message, performance.now());
    if (!sampleClock) return;
    const joining = !serverClock;
    if (joining)
      menuPosition =
        sourceIndex === menuOrder[menuSlot] ? audio.currentTime : 0;
    serverClock = sampleClock;
    syncNoticePending = true;
    player.classList.add("music-synced");
    clearInterval(clockInterval);
    function sample() {
      const id = ++requestId;
      clockRequest = { id, at: performance.now() };
      if (!request(id)) clockRequest = undefined;
    }
    sample();
    clockInterval = setInterval(sample, 10_000);
    synchronize(joining);
  }

  function clock(message) {
    if (!serverClock || !clockRequest || message.id !== clockRequest.id) return;
    const now = performance.now();
    const sampleClock = readClock(message, (clockRequest.at + now) / 2);
    clockRequest = undefined;
    if (!sampleClock) return;
    serverClock = sampleClock;
    synchronize();
  }

  function disconnect() {
    if (!serverClock) return;
    serverClock = clockRequest = undefined;
    clearInterval(clockInterval);
    clearTimeout(boundaryTimer);
    syncNoticePending = false;
    syncStatus.classList.remove("music-sync-visible");
    player.classList.remove("music-synced");
    changeTrack(menuOrder[menuSlot], () => menuPosition, true);
  }

  player.classList.remove("hidden");
  new ResizeObserver(scrollTitle).observe(titleClip);
  motion.addEventListener("change", scrollTitle);
  applyVolume();
  updateMuteButton();
  changeTrack(menuOrder[menuSlot], () => 0);
  return { connect, clock, disconnect };
})();
