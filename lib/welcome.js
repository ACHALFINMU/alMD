const fs = require("fs")

module.exports = async (sock, anu) => {
  try {
    // Baca db fresh supaya selalu dapat setting terbaru
    let db
    try {
      db = JSON.parse(fs.readFileSync("./database.json"))
    } catch {
      db = {}
    }
    if (!db.groupSettings) db.groupSettings = {}

    const metadata     = await sock.groupMetadata(anu.id)
    const participants = anu.participants
    const memberCount  = metadata.participants.length
    const gs           = db.groupSettings[anu.id] || {}

    for (let num of participants) {
      const user = num.split("@")[0]

      // ======================
      // WELCOME
      // ======================
      if (anu.action === "add") {
        if (gs.welcomeOn === false) continue
        let teks

        if (gs.welcome) {
          // Pakai teks custom, ganti variabel
          teks = gs.welcome
            .replace(/{user}/g, user)
            .replace(/{group}/g, metadata.subject)
            .replace(/{count}/g, memberCount)
        } else {
          // Default
          teks = `
╭─❖「 *WELCOME* 」❖
│ 👤 @${user}
│ 📌 Grup: ${metadata.subject}
│ 👥 Member ke: ${memberCount}
│ 🎉 Selamat datang!
│
│ Jangan lupa patuhi rules ya 😉
│
│ butuh linkps? ketik .linkps
╰───────────────
          `.trim()
        }

        await sock.sendMessage(anu.id, { text: teks, mentions: [num] })
      }

      // ======================
      // GOODBYE
      // ======================
      if (anu.action === "remove") {
        if (gs.byeOn === false) continue
        let teks

        if (gs.bye) {
          teks = gs.bye
            .replace(/{user}/g, user)
            .replace(/{group}/g, metadata.subject)
            .replace(/{count}/g, memberCount)
        } else {
          teks = `
╭─❖「 *GOODBYE* 」❖
│ 👤 @${user}
│ 📌 ${metadata.subject}
│ 👥 Sisa member: ${memberCount}
│ 😢 Telah keluar dari grup
│
│ Sampai jumpa 👋
╰───────────────
          `.trim()
        }

        await sock.sendMessage(anu.id, { text: teks, mentions: [num] })
      }
    }
  } catch (err) {
    console.log("Error welcome:", err)
  }
}
