import { interpolateInferno } from "d3-scale-chromatic"
import { MicVAD, utils } from "@ricky0123/vad-web"

const loading = setInterval(() => {
  const indicator = document.getElementById("indicator")
  const [message, ...dots] = indicator.innerHTML.split(".")
  indicator.innerHTML = message + ".".repeat((dots.length + 1) % 7)
}, 200)

function addAudio(audioUrl) {
  const entry = document.createElement("li")
  const audio = document.createElement("audio")
  audio.controls = true
  audio.src = audioUrl
  entry.classList.add("newItem")
  entry.appendChild(audio)
  return entry
}

// State for skip frame debounce feature
// States: 'normal' -> 'skipping' -> 'verifying' -> 'skipping' (if speech continues) or 'normal' (if speech ends)
let skipState = 'normal'
let skipUntil = 0
let verifyUntil = 0
let skippedFrameCount = 0
let consecutiveSpeechFrames = 0
const VERIFICATION_FRAMES_NEEDED = 3  // Number of consecutive speech frames needed to confirm speech continues

function getSkipDurationMs() {
  const input = document.getElementById("skip_duration_input")
  return input ? parseInt(input.value, 10) || 0 : 0
}

function updateSkipStats() {
  const statsEl = document.getElementById("skip_stats")
  if (statsEl) {
    statsEl.textContent = `Skipped frames: ${skippedFrameCount} | State: ${skipState}`
  }
}

async function main() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true,
      },
    })
    const myvad = await MicVAD.new({
      stream,
      model: "v5",
      baseAssetPath: "/",
      onnxWASMBasePath: "/",
      positiveSpeechThreshold: 0.4,
      negativeSpeechThreshold: 0.4,
      minSpeechFrames: 15,
      preSpeechPadFrames: 30,
      shouldSkipFrame: () => {
        const skipDurationMs = getSkipDurationMs()
        if (skipDurationMs <= 0) return false
        
        const now = Date.now()
        
        // State machine for skip/verify cycle
        if (skipState === 'skipping') {
          if (now < skipUntil) {
            // Still in skip period
            skippedFrameCount++
            updateSkipStats()
            console.log(`shouldSkipFrame: SKIPPING (${skipUntil - now}ms remaining)`)
            return true
          } else {
            // Skip period ended, enter verification state
            skipState = 'verifying'
            consecutiveSpeechFrames = 0
            console.log(`shouldSkipFrame: Skip period ended, entering VERIFYING state`)
            updateSkipStats()
            return false
          }
        }
        
        // In 'normal' or 'verifying' state, don't skip - run the model
        return false
      },
      onFrameProcessed: (probs, frame) => {
        const indicatorColor = interpolateInferno(probs.isSpeech / 2)
        document.body.style.setProperty("--indicator-color", indicatorColor)
        
        const skipDurationMs = getSkipDurationMs()
        if (skipDurationMs <= 0) return
        
        const now = Date.now()
        const isSpeech = probs.isSpeech >= 0.5
        
        if (skipState === 'verifying') {
          // In verification state, check if speech continues
          if (isSpeech) {
            consecutiveSpeechFrames++
            console.log(`onFrameProcessed: VERIFYING - speech frame ${consecutiveSpeechFrames}/${VERIFICATION_FRAMES_NEEDED}`)
            if (consecutiveSpeechFrames >= VERIFICATION_FRAMES_NEEDED) {
              // Speech confirmed, start new skip period
              skipState = 'skipping'
              skipUntil = now + skipDurationMs
              consecutiveSpeechFrames = 0
              console.log(`onFrameProcessed: Speech confirmed, entering SKIPPING state until ${skipUntil}`)
              updateSkipStats()
            }
          } else {
            // Non-speech frame during verification, reset counter
            // Let VAD handle speech end detection naturally
            consecutiveSpeechFrames = 0
            console.log(`onFrameProcessed: VERIFYING - non-speech frame, reset counter`)
          }
        } else if (skipState === 'normal') {
          // In normal state, start skip period when speech is detected
          if (isSpeech) {
            skipState = 'skipping'
            skipUntil = now + skipDurationMs
            console.log(`onFrameProcessed: Speech detected in NORMAL state, entering SKIPPING state until ${skipUntil}`)
            updateSkipStats()
          }
        }
      },
      onSpeechEnd: (arr) => {
        // Reset state when speech ends
        skipState = 'normal'
        consecutiveSpeechFrames = 0
        console.log(`onSpeechEnd: Resetting to NORMAL state`)
        
        const wavBuffer = utils.encodeWAV(arr)
        const base64 = utils.arrayBufferToBase64(wavBuffer)
        const url = `data:audio/wav;base64,${base64}`
        const el = addAudio(url)
        const speechList = document.getElementById("playlist")
        speechList.prepend(el)
      },
    })
    window.myvad = myvad

    clearInterval(loading)
    window.toggleVAD = () => {
      console.log("ran toggle vad")
      if (myvad.listening === false) {
        myvad.start()
        document.getElementById("toggle_vad_button").textContent = "STOP VAD"
        document.getElementById("indicator").textContent = "VAD is running"
      } else {
        myvad.pause()
        document.getElementById("toggle_vad_button").textContent = "START VAD"
        document.getElementById(
          "indicator"
        ).innerHTML = `VAD is <span style="color:red">stopped</span>`
        const indicatorColor = interpolateInferno(0)
        document.body.style.setProperty("--indicator-color", indicatorColor)
      }
    }
    window.toggleVAD()
    document.getElementById("toggle_vad_button").disabled = false
  } catch (e) {
    console.error("Failed:", e)
    clearInterval(loading)
    document.getElementById(
      "indicator"
    ).innerHTML = `<span style="color:red">VAD failed to load</span>`
  }
}

main()
