///////////////////////////////////////////////////////////////
//                                                           //
//  AUTOTUNE PLUGIN FOR FM-DX-WEBSERVER (V1.0)               //
//                                                           //
//  by Highpoint                last update: 2026-04-22      //
//                                                           //
//  https://github.com/Highpoint2000/Autotune                //
//                                                           //
//                                                           //
///////////////////////////////////////////////////////////////

(function() {
    "use strict";

    // ── Plugin Metadata & Update Configuration ──────────────────────────────
    var pluginVersion     = "1.0";
    var pluginName        = "AutoTune";
    var pluginHomepageUrl = "https://github.com/highpoint2000/Autotune/releases";
    var pluginUpdateUrl   = "https://raw.githubusercontent.com/highpoint2000/Autotune/main/autotune.js";
    var CHECK_FOR_UPDATES = true;
    var ENABLE_DEBUG_LOG  = false; 

    // ── Update Logic (Integrated from AF-Validator) ────────────────────────
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

                var icon =
                    document.querySelector(".wrapper-outer #navigation .sidenav-content .fa-puzzle-piece") ||
                    document.querySelector(".wrapper-outer .sidenav-content") ||
                    document.querySelector(".sidenav-content");
                if (icon && !icon.querySelector("." + pluginName + "-update-dot")) {
                    var dot = document.createElement("span");
                    dot.className = pluginName + "-update-dot";
                    dot.style.cssText =
                        "display:block;width:12px;height:12px;border-radius:50%;" +
                        "background-color:#FE0830;margin-left:82px;margin-top:-12px;position:absolute;";
                    icon.appendChild(dot);
                }
            })
            .catch(function (e) {
                console.warn("[" + pluginName + "] Update check failed:", e);
            });
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
            // White text logging as requested
            console.log(`%c[${pluginName}] %c${msg}`, "color: #FFFFFF; font-weight: bold;", "color: #FFFFFF;", data);
        }
    }

    // --- WebSocket Integration ---
    async function initWebSocket() {
        try {
            // Use the shared server socket promise
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
        } catch (err) {
            log("Error accessing window.socketPromise:", err);
        }
    }

    function sendToTuner(freqMHz) {
        if (textSocket && textSocket.readyState === WebSocket.OPEN) {
            const khz = Math.round(freqMHz * 1000);
            textSocket.send(`T${khz}`);
            tunerData.freq = parseFloat(freqMHz);
        }
    }

    function hijackButtons() {
        const upBtn = document.getElementById('freq-up');
        const downBtn = document.getElementById('freq-down');
        if (upBtn) {
            const newUp = upBtn.cloneNode(true);
            upBtn.parentNode.replaceChild(newUp, upBtn);
            newUp.addEventListener('click', (e) => {
                e.stopPropagation();
                let current = tunerData.freq;
                let nextFreq = (Math.floor((current + 0.05) * 10) + 1) / 10;
                log(`HIJACK UP: ${current} -> ${nextFreq.toFixed(2)}`);
                sendToTuner(nextFreq);
                updateUI(nextFreq);
            });
        }
        if (downBtn) {
            const newDown = downBtn.cloneNode(true);
            downBtn.parentNode.replaceChild(newDown, downBtn);
            newDown.addEventListener('click', (e) => {
                e.stopPropagation();
                let current = tunerData.freq;
                let nextFreq = (Math.ceil((current - 0.05) * 10) - 1) / 10;
                log(`HIJACK DOWN: ${current} -> ${nextFreq.toFixed(2)}`);
                sendToTuner(nextFreq);
                updateUI(nextFreq);
            });
        }
    }

    function updateUI(freqMHz) {
        if (typeof window.currentFrequency !== 'undefined') {
            window.currentFrequency = parseFloat(freqMHz);
        }
    }

    async function performAutoTune() {
        if (isTuningInternally || tunerData.freq === null) return;
        isTuningInternally = true;
        log(`Initializing Scan...`);
        await sleep(SETTLE_TIME_MS);

        const getScore = () => {
            let penalty = (tunerData.cci + tunerData.aci) * INTERFERENCE_PENALTY_FACTOR;
            return tunerData.sig - penalty;
        };

        let centerFreqKHz = Math.round(tunerData.freq * 1000);
        let bestFreqKHz = centerFreqKHz;
        let isAM = centerFreqKHz < 30000;
        let stepKHz = isAM ? 1 : 10;

        let maxScore = getScore();
        log(`Base ${tunerData.freq} MHz: Score: ${maxScore.toFixed(2)} (Sig: ${tunerData.sig}, CCI: ${tunerData.cci}, ACI: ${tunerData.aci})`);

        for (let dir of [stepKHz, -stepKHz]) {
            for (let i = 1; i <= SCAN_STEPS; i++) {
                let testKHz = centerFreqKHz + (i * dir);
                let testMHz = testKHz / 1000;
                sendToTuner(testMHz);
                await sleep(SETTLE_TIME_MS);
                let currentScore = getScore();
                log(`Check ${testMHz.toFixed(3)} MHz: Score ${currentScore.toFixed(2)} (Sig: ${tunerData.sig}, CCI: ${tunerData.cci}, ACI: ${tunerData.aci})`);
                if (currentScore > maxScore) {
                    maxScore = currentScore;
                    bestFreqKHz = testKHz;
                    log(`--> New best frequency found!`);
                } else break;
            }
        }
        
        const finalFreqMHz = (bestFreqKHz / 1000).toFixed(isAM ? 3 : 2);
        log(`RESULT: Selecting ${finalFreqMHz} MHz (Score: ${maxScore.toFixed(2)})`);
        sendToTuner(parseFloat(finalFreqMHz));
        updateUI(parseFloat(finalFreqMHz));
        hijackButtons();
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
        const freqContainer = document.getElementById("freq-container");
        if (!freqContainer || document.getElementById('autotune-btn')) return;
        const btn = document.createElement("button");
        btn.id = 'autotune-btn';
        btn.className = 'autotune-button';
        btn.innerHTML = 'Auto<br>Tune';
        // Tooltip description
        btn.title = 'Optimize current frequency for best signal and lowest interference';
        
        btn.onclick = async (e) => {
            e.stopPropagation(); 
            btn.classList.add('active');
            await performAutoTune();
            btn.classList.remove('active');
        };
        
        freqContainer.appendChild(btn);
        hijackButtons();
    }

    function _init() {
        initWebSocket();
        setTimeout(injectButton, 500);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { setTimeout(_init, 400); });
    } else {
        setTimeout(_init, 400);
    }

})();