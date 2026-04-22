////////////////////////////////////////////////////////////
///                                                      ///
///  AUTOTUNE SCRIPT FOR FM-DX-WEBSERVER                 ///
///                                                      ///
///  by Highpoint                last update: 22.04.25   ///
///                                                      ///
///  https://github.com/Highpoint2000/Autotune           ///
///                                                      ///
////////////////////////////////////////////////////////////

(function() {
    "use strict";

    // ── Plugin Metadata & Update Configuration ──────────────────────────────
    var pluginVersion     = "1.0a";
    var pluginName        = "AutoTune";
    var pluginHomepageUrl = "https://github.com/highpoint2000/Autotune/releases";
    var pluginUpdateUrl   = "https://raw.githubusercontent.com/Highpoint2000/Autotune/refs/heads/main/Autotune/autotune.js";
    var CHECK_FOR_UPDATES = true;
    var ENABLE_DEBUG_LOG  = true; 

    // ── Update Logic ────────────────────────────────────────────────────────
    function _checkUpdate() {
        fetch(pluginUpdateUrl + "?t=" + Date.now(), { cache: "no-store" })
            .then(function (r) { return r.ok ? r.text() : null; })
            .then(function (txt) {
                if (!txt) return;
                var m = txt.match(/var\s+pluginVersion\s*=\s*["']([^"']+)["']/);
                if (!m) return;
                var remote = m[1];
                if (remote === pluginVersion) return;
                console.log("[" + pluginName + "] Update available: " + pluginVersion + " → " + remote);

                var settings = document.getElementById("plugin-settings");
                if (settings && settings.innerHTML.indexOf(pluginHomepageUrl) === -1) {
                    if (settings.textContent.trim() === "No plugin settings are available.") settings.textContent = "";
                    settings.innerHTML +=
                        "<br><a href='" + pluginHomepageUrl + "' target='_blank'>[" +
                        pluginName + "] Update: " + pluginVersion + " → " + remote + "</a>";
                }

                var icon = document.querySelector(".fa-puzzle-piece")?.parentElement;
                if (icon && !icon.querySelector("." + pluginName + "-update-dot")) {
                    var dot = document.createElement("span");
                    dot.className = pluginName + "-update-dot";
                    dot.style.cssText = "display:block;width:12px;height:12px;border-radius:50%;background-color:#FE0830;position:absolute;right:0;top:0;";
                    icon.appendChild(dot);
                }
            })
            .catch(function (e) { console.warn("[" + pluginName + "] Update check failed:", e); });
    }
    if (CHECK_FOR_UPDATES) _checkUpdate();

    // ── Core Configuration ──────────────────────────────────────────────────
    const SCAN_STEPS = 4;
    const SETTLE_TIME_MS = 300;
    const INTERFERENCE_PENALTY_FACTOR = 0.15;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let isTuningInternally = false;
    let textSocket;
    let tunerData = { freq: null, sig: -Infinity, cci: 0, aci: 0 };

    function log(msg, data = "") {
        if (ENABLE_DEBUG_LOG) {
            console.log(`%c[${pluginName}] %c${msg}`, "color: #FFFFFF; font-weight: bold;", "color: #FFFFFF;", data);
        }
    }

    // --- WebSocket Integration ---
    async function initWebSocket() {
        try {
            textSocket = await window.socketPromise;
            log("Connected to shared server WebSocket.");

            textSocket.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.freq !== undefined) tunerData.freq = parseFloat(data.freq);
                    if (data.sig !== undefined)  tunerData.sig  = parseFloat(data.sig);
                    if (data.sigRaw !== undefined) {
                        const raw = data.sigRaw;
                        const c1 = raw.indexOf(','), c2 = raw.indexOf(',', c1 + 1);
                        if (c1 !== -1) {
                            tunerData.cci = parseInt(raw.slice(c1 + 1, c2 === -1 ? undefined : c2), 10) || 0;
                            tunerData.aci = c2 === -1 ? 0 : parseInt(raw.slice(c2 + 1), 10) || 0;
                        }
                    }
                } catch (e) {}
            });
        } catch (err) { log("Error accessing socketPromise:", err); }
    }

    function sendToTuner(freqMHz) {
        if (textSocket && textSocket.readyState === WebSocket.OPEN) {
            const khz = Math.round(freqMHz * 1000);
            textSocket.send(`T${khz}`);
            tunerData.freq = parseFloat(freqMHz);
        }
    }

    function installSmartInterceptor() {
        window.addEventListener('click', function(e) {
            const upBtn = e.target.closest('#freq-up');
            const downBtn = e.target.closest('#freq-down');
            if (!upBtn && !downBtn) return;

            const currentFreq = tunerData.freq || parseFloat(document.getElementById('data-station-freq')?.textContent);
            if (currentFreq && currentFreq >= 30) {
                e.stopImmediatePropagation();
                e.preventDefault();

                if (upBtn) {
                    let nextFreq = (Math.floor((currentFreq + 0.05) * 10) + 1) / 10;
                    sendToTuner(nextFreq);
                    updateUI(nextFreq);
                } else if (downBtn) {
                    let nextFreq = (Math.ceil((currentFreq - 0.05) * 10) - 1) / 10;
                    sendToTuner(nextFreq);
                    updateUI(nextFreq);
                }
            }
        }, true);
    }

    function updateUI(freqMHz) {
        if (typeof window.currentFrequency !== 'undefined') {
            window.currentFrequency = parseFloat(freqMHz);
        }
    }

    async function performAutoTune() {
        if (isTuningInternally || tunerData.freq === null) return;
        isTuningInternally = true;
        
        // --- FIXED ANCHOR LOGIC ---
        // We round to the nearest .1 MHz (FM) or .001 MHz (AM) to establish the 'Home' frequency.
        // This ensures a click on 105.060 is anchored to 105.100.
        let isAM = tunerData.freq < 30;
        let anchorFreqKHz = isAM ? Math.round(tunerData.freq * 1000) : Math.round(Math.round(tunerData.freq * 10) * 100);
        let stepKHz = isAM ? 1 : 10;

        log(`Initializing Scan... Anchor: ${(anchorFreqKHz/1000).toFixed(3)} MHz`);
        
        // Move to anchor first to start from a clean baseline
        sendToTuner(anchorFreqKHz / 1000);
        await sleep(SETTLE_TIME_MS);

        const getScore = () => tunerData.sig - ((tunerData.cci + tunerData.aci) * INTERFERENCE_PENALTY_FACTOR);

        let bestFreqKHz = anchorFreqKHz;
        let maxScore = getScore();

        for (let dir of [stepKHz, -stepKHz]) {
            for (let i = 1; i <= SCAN_STEPS; i++) {
                let testKHz = anchorFreqKHz + (i * dir);
                let testMHz = testKHz / 1000;
                
                sendToTuner(testMHz);
                await sleep(SETTLE_TIME_MS);
                
                let currentScore = getScore();
                log(`Check ${testMHz.toFixed(3)} MHz: Score ${currentScore.toFixed(2)}`);

                if (currentScore > maxScore) {
                    maxScore = currentScore;
                    bestFreqKHz = testKHz;
                    log(`--> New best found within range.`);
                }
            }
        }
        
        const finalFreqMHz = (bestFreqKHz / 1000).toFixed(isAM ? 3 : 2);
        log(`RESULT: Final selection ${finalFreqMHz} MHz`);
        sendToTuner(parseFloat(finalFreqMHz));
        updateUI(parseFloat(finalFreqMHz));
        
        setTimeout(() => { isTuningInternally = false; }, 1000);
    }

    // --- Styling & Injection ---
    const style = document.createElement('style');
    style.innerHTML = `
        #freq-container { position: relative !important; }
        .autotune-button {
            position: absolute !important; 
            bottom: 6px !important; 
            right: 5px !important; 
            z-index: 1000 !important;
            display: flex !important; 
            align-items: center !important; 
            justify-content: center !important;
            height: 30px !important; 
            min-width: 34px !important; 
            max-width: 34px !important; 
            padding: 0 !important;
            font-size: 11px !important; 
            font-weight: bold !important; 
            line-height: 1.1 !important;
            color: var(--color-main) !important; 
            background-color: var(--color-3) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important; 
            border-radius: 10px !important;
            cursor: pointer !important; 
            transition: all 0.2s ease-in-out !important; 
            text-align: center !important;
        }
        .autotune-button:hover {
            filter: brightness(1.3);
            background-color: var(--color-4) !important;
        }
        .autotune-button.active { background-color: var(--color-4) !important; }
    `;
    document.head.appendChild(style);

    function injectButton() {
        if (document.getElementById('autotune-btn')) return;
        const container = document.getElementById("freq-container");
        if (!container) return;
        const btn = document.createElement("button");
        btn.id = 'autotune-btn';
        btn.className = 'autotune-button';
        btn.innerHTML = 'Auto<br>Tune';
        btn.title = 'Optimize current frequency for best signal and lowest interference';
        btn.onclick = async (e) => {
            e.stopPropagation();
            btn.classList.add('active');
            await performAutoTune();
            btn.classList.remove('active');
        };
        container.appendChild(btn);
    }

    function _init() {
        initWebSocket();
        installSmartInterceptor();
        setTimeout(injectButton, 500);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { setTimeout(_init, 400); });
    } else {
        setTimeout(_init, 400);
    }
})();