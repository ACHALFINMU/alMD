const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys")

const pino = require("pino")
const readline = require("readline")
const { Boom } = require("@hapi/boom")

// IMPORT FITUR
const welcome = require("./lib/welcome")
const handler = require("./handler")

// input terminal
const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  return new Promise(resolve => rl.question(text, resolve))
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session")
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  })

  // ======================
  // PAIRING CODE LOGIN
  // ======================
  if (!sock.authState.creds.registered) {
    let number = await question("Masukkan nomor (628xxx): ")
    number = number.replace(/[^0-9]/g, "")

    const code = await sock.requestPairingCode(number)
    console.log("\n✅ Pairing Code:", code)
    console.log("Masukkan ke WhatsApp > Linked Devices\n")
  }

  // ======================
  // SIMPAN SESSION
  // ======================
  sock.ev.on("creds.update", saveCreds)

  // ======================
  // CONNECTION
  // ======================
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update

    if (connection === "close") {
      let reason = new Boom(lastDisconnect?.error)?.output.statusCode

      if (reason === DisconnectReason.loggedOut) {
        console.log("❌ Session keluar, hapus folder session")
      } else {
        console.log("🔄 Reconnecting...")
        startBot()
      }
    } else if (connection === "open") {
      console.log("✅ Bot berhasil connect")
    }
  })

  // ======================
  // ✅ INI LETAK WELCOME
  // ======================
  sock.ev.on("group-participants.update", async (anu) => {
    await welcome(sock, anu)
  })

  // ======================
  // MESSAGE LISTENER
  // ======================
 sock.ev.on("messages.upsert", async ({ messages }) => {
  const msg = messages[0]
  if (!msg.message) return

  handler(sock, msg)
})
}

startBot()