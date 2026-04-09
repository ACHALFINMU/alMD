const fs = require("fs")

const startTime = Date.now()

function getUptime() {
  const total = Math.floor((Date.now() - startTime) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}j ${m}m ${s}d`
}

// ======================
// LOAD DATABASE
// ======================
let db
try {
  db = JSON.parse(fs.readFileSync("./database.json"))
} catch {
  db = {}
}

if (!db.owners)        db.owners        = []
if (!db.allowedUsers)  db.allowedUsers  = []
if (!db.linkPS)        db.linkPS        = ""
if (!db.promosi)       db.promosi       = ""
if (!db.groupSettings) db.groupSettings = {}
if (!db.jadwal)        db.jadwal        = []

db.owners       = [...new Set(db.owners)]
db.allowedUsers = [...new Set(db.allowedUsers)]

const saveDB = () => {
  db.owners       = [...new Set(db.owners)]
  db.allowedUsers = [...new Set(db.allowedUsers)]
  fs.writeFileSync("./database.json", JSON.stringify(db, null, 2))
}

saveDB()

// ======================
// SCHEDULER (cek setiap menit)
// ======================
let sockGlobal = null

setInterval(async () => {
  if (!sockGlobal) return

  const now   = new Date()
  const jam   = String(now.getHours()).padStart(2, "0")
  const menit = String(now.getMinutes()).padStart(2, "0")
  const waktuSekarang = `${jam}:${menit}`

  // Jadwal pesan
  if (db.jadwal && db.jadwal.length > 0) {
    for (const j of db.jadwal) {
      if (j.waktu !== waktuSekarang) continue
      if (j.lastSent === waktuSekarang) continue

      try {
        await sockGlobal.sendMessage(j.groupId, { text: `📅 *Pesan Terjadwal*\n\n${j.pesan}` })
        j.lastSent = waktuSekarang
        saveDB()
      } catch (e) {
        console.log("Gagal kirim jadwal:", e.message)
      }
    }
  }

  // Auto close & auto open grup
  if (db.groupSettings) {
    const now2  = new Date()
    const tgl   = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}-${String(now2.getDate()).padStart(2,"0")}`
    const keyClose = `${tgl} ${waktuSekarang}`
    const keyOpen  = `${tgl} ${waktuSekarang}`

    for (const [gid, gs] of Object.entries(db.groupSettings)) {
      // Auto close
      if (gs.autoClose && gs.autoClose === waktuSekarang) {
        if (gs.lastAutoClose !== keyClose) {
          try {
            await sockGlobal.groupSettingUpdate(gid, "announcement")
            await sockGlobal.sendMessage(gid, { text: "🔒 Grup otomatis ditutup" })
            gs.lastAutoClose = keyClose
            saveDB()
          } catch (e) { console.log("Gagal auto close:", e.message) }
        }
      }

      // Auto open
      if (gs.autoOpen && gs.autoOpen === waktuSekarang) {
        if (gs.lastAutoOpen !== keyOpen) {
          try {
            await sockGlobal.groupSettingUpdate(gid, "not_announcement")
            await sockGlobal.sendMessage(gid, { text: "🔓 Grup otomatis dibuka" })
            gs.lastAutoOpen = keyOpen
            saveDB()
          } catch (e) { console.log("Gagal auto open:", e.message) }
        }
      }
    }
  }
}, 60 * 1000)

// ======================
// HELPER: ambil/init setting per grup
// ======================
function getGS(gid) {
  if (!db.groupSettings[gid]) {
    db.groupSettings[gid] = {
      antilink:     false,
      antiteruskan: false,
      welcome:      "",
      bye:          "",
      autoClose:    "",
      autoOpen:     ""
    }
    saveDB()
  }
  if (db.groupSettings[gid].antilink     === undefined) db.groupSettings[gid].antilink     = false
  if (db.groupSettings[gid].antiteruskan === undefined) db.groupSettings[gid].antiteruskan = false
  if (db.groupSettings[gid].autoClose    === undefined) db.groupSettings[gid].autoClose    = ""
  if (db.groupSettings[gid].autoOpen     === undefined) db.groupSettings[gid].autoOpen     = ""
  if (db.groupSettings[gid].welcomeOn    === undefined) db.groupSettings[gid].welcomeOn    = true
  if (db.groupSettings[gid].byeOn        === undefined) db.groupSettings[gid].byeOn        = true
  return db.groupSettings[gid]
}

// ======================
// HELPER: normalisasi nomor WA
// ======================
function normNum(jid) {
  return jid.replace(/[^0-9]/g, "").replace(/^0/, "62")
}

// ======================
// HANDLER
// ======================
module.exports = async (sock, msg) => {
  try {
    sockGlobal = sock
    const from   = msg.key.remoteJid
    const sender = msg.key.participant || msg.key.remoteJid
    const senderNumber = normNum(sender.split("@")[0])

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text

    const text    = body ? body.toLowerCase() : ""
    const isGroup = from.endsWith("@g.us")

    // ======================
    // GROUP DATA
    // ======================
    let groupMetadata = isGroup ? await sock.groupMetadata(from) : {}
    let participants  = isGroup ? groupMetadata.participants : []
    let groupAdmins   = isGroup
      ? participants.filter(v => v.admin !== null).map(v => v.id)
      : []

    const isAdmin   = groupAdmins.some(a => normNum(a.split("@")[0]) === senderNumber)
    const isOwner   = db.owners.map(normNum).includes(senderNumber)
    const isAllowed = isAdmin || isOwner || db.allowedUsers.map(normNum).includes(senderNumber)

    // ======================
    // ANTILINK (otomatis)
    // ======================
    if (isGroup && !isAdmin && !isOwner) {
      const gs = getGS(from)

      // Anti teruskan saluran
      if (gs.antiteruskan) {
        const m = msg.message

        // Cek semua tipe contextInfo yang mungkin
        const ctxInfo =
          m?.extendedTextMessage?.contextInfo ||
          m?.imageMessage?.contextInfo ||
          m?.videoMessage?.contextInfo ||
          m?.documentMessage?.contextInfo ||
          m?.audioMessage?.contextInfo ||
          m?.stickerMessage?.contextInfo ||
          m?.buttonsMessage?.contextInfo ||
          m?.listMessage?.contextInfo ||
          m?.templateMessage?.contextInfo ||
          m?.reactionMessage?.key ||
          m?.viewOnceMessage?.message?.imageMessage?.contextInfo ||
          m?.viewOnceMessage?.message?.videoMessage?.contextInfo

        const isForwardedChannel =
          // Metadata forward dari newsletter
          ctxInfo?.forwardedNewsletterMessageInfo ||
          // Atribusi forward newsletter
          ctxInfo?.forwardAttribution === "NEWSLETTER" ||
          // Tipe pesan khusus newsletter
          m?.newsletterAdminInviteMessage ||
          m?.scheduledCallCreationMessage ||
          // JID pengirim asli adalah newsletter
          ctxInfo?.participant?.endsWith("@newsletter") ||
          ctxInfo?.remoteJid?.endsWith("@newsletter") ||
          msg.key?.remoteJid?.endsWith("@newsletter") ||
          // Pesan diteruskan (isForwarded)
          m?.extendedTextMessage?.contextInfo?.isForwarded ||
          // Link saluran di semua teks pesan
          [
            m?.conversation,
            m?.extendedTextMessage?.text,
            m?.imageMessage?.caption,
            m?.videoMessage?.caption,
            m?.documentMessage?.caption,
            m?.buttonsMessage?.contentText,
            m?.listMessage?.description,
          ].filter(Boolean).some(t =>
            /whatsapp\.com\/channel|wa\.me\/channel|whatsapp\.com\/newsletter/i.test(t)
          )

        if (isForwardedChannel) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: sender }
            })
          } catch (e) { console.log("Gagal hapus:", e.message) }

          sock.sendMessage(from, {
            text: `🚫 @${senderNumber} dilarang meneruskan pesan dari saluran!`,
            mentions: [sender]
          })
          return
        }
      }

      // Anti link WA
      if (gs.antilink) {
        const allText = [
          msg.message?.conversation,
          msg.message?.extendedTextMessage?.text,
          msg.message?.imageMessage?.caption,
          msg.message?.videoMessage?.caption,
        ].filter(Boolean).join(" ")

        const hasWALink = /chat\.whatsapp\.com|wa\.me|whatsapp\.com\/channel|whatsapp\.com\/newsletter/i.test(allText)

        if (hasWALink) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, fromMe: false, id: msg.key.id, participant: sender }
            })
          } catch (e) { console.log("Gagal hapus:", e.message) }

          sock.sendMessage(from, {
            text: `⚠️ @${senderNumber} dilarang mengirim link WhatsApp!`,
            mentions: [sender]
          })
          return
        }
      }
    }


    // ======================
    // MENU
    // ======================
    if (text === ".menu") {
      const uptime = getUptime()
      const linkps = db.linkPS || "Belum diset"
      let statusAnti = ""
      if (isGroup) {
        const gs = getGS(from)
        statusAnti = `\n│ 🔗 Antilink: ${gs.antilink ? "✅ ON" : "❌ OFF"}\n│ 📢 Anti Teruskan: ${gs.antiteruskan ? "✅ ON" : "❌ OFF"}\n│ 🔒 Auto Close: ${gs.autoClose || "❌ OFF"}\n│ 🔓 Auto Open: ${gs.autoOpen || "❌ OFF"}\n│ 👋 Welcome: ${gs.welcomeOn !== false ? "✅ ON" : "❌ OFF"}\n│ 👋 Goodbye: ${gs.byeOn !== false ? "✅ ON" : "❌ OFF"}`
      }

      return sock.sendMessage(from, {
        text: `
╭─❖「 *MENU BOT* 」❖
│ ⏱️ Uptime: ${uptime}
│ 🔗 Link PS: ${linkps}${statusAnti}
│
│ 📢 .linkps
│
├─❖「 *ADMIN & OWNER* 」
│ ⚙️ .kick (reply/tag)
│ 🗑️ .del (reply)
│ 🔓 .open
│ 🔒 .close
│ 🔗 .setlinkps <link>
│ 📣 .promosi
│ 📣 .setpromosi <teks>
│
│ 👋 .setwelcome <teks>
│ 👋 .setbye <teks>
│ 🔄 .resetwelcome
│ 🔄 .resetbye
│ 🔛 .welcome on/off
│ 🔛 .goodbye on/off
│ 🚫 .antilink on/off
│ 📢 .antiteruskan on/off
│ 🔒 .autoclose HH:MM / off
│ 🔓 .autoopen HH:MM / off
│ 📅 .jadwal HH:MM <pesan>
│ 📋 .listjadwal
│ 🗑️ .hapusjadwal <nomor>
│
╰───────────────
        `.trim()
      })
    }

    // ======================
    // LINK PS
    // ======================
    if (text === ".linkps") {
      if (!db.linkPS)
        return sock.sendMessage(from, { text: "📭 Link PS belum diset" })

      return sock.sendMessage(from, { text: `🔗 *Link PS:*\n${db.linkPS}` })
    }

    // ======================
    // SET LINK PS
    // ======================
    if (text.startsWith(".setlinkps")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const link = body.slice(10).trim()
      if (!link)
        return sock.sendMessage(from, { text: "❌ Tulis linknya\nContoh: .setlinkps https://wa.me/628xxx" })

      db.linkPS = link
      saveDB()
      return sock.sendMessage(from, { text: `✅ Link PS berhasil disimpan:\n${link}` })
    }

    // ======================
    // PROMOSI
    // ======================
    if (text === ".promosi") {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      if (!db.promosi)
        return sock.sendMessage(from, { text: "📭 Teks promosi belum diset" })

      return sock.sendMessage(from, { text: db.promosi })
    }

    // ======================
    // SET PROMOSI
    // ======================
    if (text.startsWith(".setpromosi")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const teks = body.slice(11).trim()
      if (!teks)
        return sock.sendMessage(from, { text: "❌ Tulis teks promosinya\nContoh: .setpromosi Halo! Kami buka order..." })

      db.promosi = teks
      saveDB()
      return sock.sendMessage(from, { text: "✅ Teks promosi berhasil disimpan" })
    }

    // ======================
    // ANTILINK ON/OFF
    // ======================
    if (text.startsWith(".antilink")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = text.split(" ")[1]
      if (arg !== "on" && arg !== "off")
        return sock.sendMessage(from, { text: "❌ Gunakan: .antilink on atau .antilink off" })

      const gs = getGS(from)
      gs.antilink = arg === "on"
      saveDB()
      return sock.sendMessage(from, {
        text: `🚫 Antilink *${arg.toUpperCase()}*\nAdmin & owner tetap bisa kirim link.`
      })
    }

    // ======================
    // ANTI TERUSKAN ON/OFF
    // ======================
    if (text.startsWith(".antiteruskan")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = text.split(" ")[1]
      if (arg !== "on" && arg !== "off")
        return sock.sendMessage(from, { text: "❌ Gunakan: .antiteruskan on atau .antiteruskan off" })

      const gs = getGS(from)
      gs.antiteruskan = arg === "on"
      saveDB()
      return sock.sendMessage(from, {
        text: `📢 Anti Teruskan Saluran *${arg.toUpperCase()}*\nAdmin & owner tetap bisa teruskan.`
      })
    }

    // ======================
    // SET WELCOME
    // ======================
    if (text.startsWith(".setwelcome")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const teks = body.slice(11).trim()
      if (!teks)
        return sock.sendMessage(from, {
          text: "❌ Tulis teks welcomenya\nVariabel tersedia:\n{user} = nama member\n{group} = nama grup\n{count} = jumlah member\n\nContoh:\n.setwelcome Halo @{user}! Selamat datang di {group} 🎉"
        })

      const gs = getGS(from)
      gs.welcome = teks
      saveDB()
      return sock.sendMessage(from, { text: `✅ Teks welcome disimpan:\n\n${teks}` })
    }

    // ======================
    // SET BYE
    // ======================
    if (text.startsWith(".setbye")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const teks = body.slice(7).trim()
      if (!teks)
        return sock.sendMessage(from, {
          text: "❌ Tulis teks byenya\nVariabel tersedia:\n{user} = nama member\n{group} = nama grup\n{count} = sisa member\n\nContoh:\n.setbye Sampai jumpa @{user} 👋"
        })

      const gs = getGS(from)
      gs.bye = teks
      saveDB()
      return sock.sendMessage(from, { text: `✅ Teks bye disimpan:\n\n${teks}` })
    }

    // ======================
    // RESET WELCOME
    // ======================
    if (text === ".resetwelcome") {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const gs = getGS(from)
      gs.welcome = ""
      saveDB()
      return sock.sendMessage(from, { text: "🔄 Teks welcome dikembalikan ke default" })
    }

    // ======================
    // RESET BYE
    // ======================
    if (text === ".resetbye") {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const gs = getGS(from)
      gs.bye = ""
      saveDB()
      return sock.sendMessage(from, { text: "🔄 Teks bye dikembalikan ke default" })
    }

    // ======================
    // WELCOME ON/OFF
    // ======================
    if (text.startsWith(".welcome")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = text.split(" ")[1]
      if (arg !== "on" && arg !== "off")
        return sock.sendMessage(from, { text: "❌ Gunakan: .welcome on atau .welcome off" })

      const gs = getGS(from)
      gs.welcomeOn = arg === "on"
      saveDB()
      return sock.sendMessage(from, { text: `👋 Pesan welcome *${arg.toUpperCase()}*` })
    }

    // ======================
    // GOODBYE ON/OFF
    // ======================
    if (text.startsWith(".goodbye")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = text.split(" ")[1]
      if (arg !== "on" && arg !== "off")
        return sock.sendMessage(from, { text: "❌ Gunakan: .goodbye on atau .goodbye off" })

      const gs = getGS(from)
      gs.byeOn = arg === "on"
      saveDB()
      return sock.sendMessage(from, { text: `👋 Pesan goodbye *${arg.toUpperCase()}*` })
    }

    // ======================
    // AUTO CLOSE
    // ======================
    if (text.startsWith(".autoclose")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = body.slice(10).trim()
      if (!arg)
        return sock.sendMessage(from, { text: "❌ Contoh: .autoclose 22:00 atau .autoclose off" })

      const gs = getGS(from)

      if (arg.toLowerCase() === "off") {
        gs.autoClose = ""
        saveDB()
        return sock.sendMessage(from, { text: "✅ Auto close dimatikan" })
      }

      if (!/^\d{2}:\d{2}$/.test(arg))
        return sock.sendMessage(from, { text: "❌ Format waktu salah, gunakan HH:MM\nContoh: .autoclose 22:00" })

      const [hh, mm] = arg.split(":").map(Number)
      if (hh > 23 || mm > 59)
        return sock.sendMessage(from, { text: "❌ Waktu tidak valid" })

      gs.autoClose = arg
      saveDB()
      return sock.sendMessage(from, { text: `🔒 Auto close grup aktif setiap hari pukul *${arg}*` })
    }

    // ======================
    // AUTO OPEN
    // ======================
    if (text.startsWith(".autoopen")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const arg = body.slice(9).trim()
      if (!arg)
        return sock.sendMessage(from, { text: "❌ Contoh: .autoopen 08:00 atau .autoopen off" })

      const gs = getGS(from)

      if (arg.toLowerCase() === "off") {
        gs.autoOpen = ""
        saveDB()
        return sock.sendMessage(from, { text: "✅ Auto open dimatikan" })
      }

      if (!/^\d{2}:\d{2}$/.test(arg))
        return sock.sendMessage(from, { text: "❌ Format waktu salah, gunakan HH:MM\nContoh: .autoopen 08:00" })

      const [hh, mm] = arg.split(":").map(Number)
      if (hh > 23 || mm > 59)
        return sock.sendMessage(from, { text: "❌ Waktu tidak valid" })

      gs.autoOpen = arg
      saveDB()
      return sock.sendMessage(from, { text: `🔓 Auto open grup aktif setiap hari pukul *${arg}*` })
    }


    // ======================
    // JADWAL
    // ======================
    if (text.startsWith(".jadwal")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const args = body.slice(7).trim()
      if (!args)
        return sock.sendMessage(from, {
          text: "❌ Format salah\nContoh: .jadwal 08:00 Selamat pagi semua! 🌅"
        })

      const spasi = args.indexOf(" ")
      if (spasi === -1)
        return sock.sendMessage(from, {
          text: "❌ Pesannya kosong\nContoh: .jadwal 08:00 Selamat pagi semua!"
        })

      const waktu = args.slice(0, spasi).trim()
      const pesan = args.slice(spasi + 1).trim()

      if (!/^\d{2}:\d{2}$/.test(waktu))
        return sock.sendMessage(from, {
          text: "❌ Format waktu salah, gunakan HH:MM\nContoh: .jadwal 08:00 Halo!"
        })

      const [hh, mm] = waktu.split(":").map(Number)
      if (hh > 23 || mm > 59)
        return sock.sendMessage(from, { text: "❌ Waktu tidak valid" })

      if (!pesan)
        return sock.sendMessage(from, { text: "❌ Pesan tidak boleh kosong" })

      const id = Date.now()
      db.jadwal.push({ id, groupId: from, waktu, pesan, lastSent: "" })
      saveDB()

      return sock.sendMessage(from, {
        text: `✅ Jadwal disimpan!\n⏰ Waktu: ${waktu}\n📝 Pesan: ${pesan}\n\nAkan dikirim otomatis setiap hari.`
      })
    }

    // ======================
    // LIST JADWAL
    // ======================
    if (text === ".listjadwal") {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const jadwalGrup = db.jadwal.filter(j => j.groupId === from)
      if (jadwalGrup.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada jadwal di grup ini" })

      let teks = "📅 *LIST JADWAL:*\n\n"
      jadwalGrup.forEach((j, i) => {
        teks += `${i + 1}. ⏰ ${j.waktu}\n   📝 ${j.pesan}\n\n`
      })

      return sock.sendMessage(from, { text: teks.trim() })
    }

    // ======================
    // HAPUS JADWAL
    // ======================
    if (text.startsWith(".hapusjadwal")) {
      if (!isOwner && !isAdmin)
        return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })
      if (!isGroup)
        return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const nomorStr = body.slice(12).trim()
      const nomor    = parseInt(nomorStr)

      if (!nomorStr || isNaN(nomor) || nomor < 1)
        return sock.sendMessage(from, { text: "❌ Tulis nomornya\nContoh: .hapusjadwal 1" })

      const jadwalGrup = db.jadwal.filter(j => j.groupId === from)
      if (nomor > jadwalGrup.length)
        return sock.sendMessage(from, { text: `❌ Nomor tidak ada. Total jadwal: ${jadwalGrup.length}` })

      const target = jadwalGrup[nomor - 1]
      db.jadwal = db.jadwal.filter(j => j.id !== target.id)
      saveDB()

      return sock.sendMessage(from, {
        text: `✅ Jadwal ⏰ ${target.waktu} berhasil dihapus`
      })
    }

    // ======================
    // ADD AKSES
    // ======================
    if (text.startsWith(".addakses")) {
      if (!isGroup) return sock.sendMessage(from, { text: "❌ Hanya di grup" })
      if (!isOwner && !isAdmin) return sock.sendMessage(from, { text: "❌ Khusus owner & admin" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (db.allowedUsers.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Sudah ada akses" })

      db.allowedUsers.push(targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `✅ Akses ditambahkan untuk @${targetNumber}`,
        mentions: [target]
      })
    }

    // ======================
    // DEL AKSES
    // ======================
    if (text.startsWith(".delakses")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (!db.allowedUsers.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Nomor itu tidak ada di daftar akses" })

      db.allowedUsers = db.allowedUsers.filter(v => normNum(v) !== targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `❌ Akses dihapus untuk @${targetNumber}`,
        mentions: [target]
      })
    }

    // ======================
    // LIST AKSES
    // ======================
    if (text === ".listakses") {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })
      if (db.allowedUsers.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada user yang punya akses" })

      let teks = "📋 *LIST AKSES:*\n\n"
      db.allowedUsers.forEach((u, i) => { teks += `${i + 1}. @${u}\n` })
      const mentions = db.allowedUsers.map(u => u + "@s.whatsapp.net")
      return sock.sendMessage(from, { text: teks, mentions })
    }

    // ======================
    // ADD OWNER
    // ======================
    if (text.startsWith(".addowner")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (db.owners.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Sudah jadi owner" })

      db.owners.push(targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `✅ @${targetNumber} ditambahkan sebagai owner`,
        mentions: [target]
      })
    }

    // ======================
    // DEL OWNER
    // ======================
    if (text.startsWith(".delowner")) {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!target) return sock.sendMessage(from, { text: "❌ Tag orangnya" })

      const targetNumber = normNum(target.split("@")[0])
      if (!db.owners.map(normNum).includes(targetNumber))
        return sock.sendMessage(from, { text: "⚠️ Nomor itu bukan owner" })

      if (db.owners.length === 1 && normNum(db.owners[0]) === senderNumber)
        return sock.sendMessage(from, { text: "⚠️ Tidak bisa hapus owner terakhir" })

      db.owners = db.owners.filter(v => normNum(v) !== targetNumber)
      saveDB()
      return sock.sendMessage(from, {
        text: `❌ @${targetNumber} dihapus dari owner`,
        mentions: [target]
      })
    }

    // ======================
    // LIST OWNER
    // ======================
    if (text === ".listowner") {
      if (!isOwner) return sock.sendMessage(from, { text: "❌ Khusus owner" })
      if (db.owners.length === 0)
        return sock.sendMessage(from, { text: "📭 Belum ada owner terdaftar" })

      let teks = "👑 *LIST OWNER:*\n\n"
      db.owners.forEach((u, i) => { teks += `${i + 1}. @${u}\n` })
      const mentions = db.owners.map(u => u + "@s.whatsapp.net")
      return sock.sendMessage(from, { text: teks, mentions })
    }

    // ======================
    // KICK
    // ======================
    if (text.startsWith(".kick")) {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      if (!isGroup)   return sock.sendMessage(from, { text: "❌ Hanya di grup" })

      const target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message?.extendedTextMessage?.contextInfo?.participant

      if (!target) return sock.sendMessage(from, { text: "❌ Reply/tag member" })
      if (groupAdmins.includes(target))
        return sock.sendMessage(from, { text: "❌ Tidak bisa kick admin" })

      await sock.groupParticipantsUpdate(from, [target], "remove")
      sock.sendMessage(from, {
        text: `✅ @${target.split("@")[0]} berhasil dikeluarkan`,
        mentions: [target]
      })
    }

    // ======================
    // DELETE PESAN
    // ======================
    if (text === ".del") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })

      const quoted = msg.message?.extendedTextMessage?.contextInfo
      if (!quoted) return sock.sendMessage(from, { text: "❌ Reply pesan" })

      await sock.sendMessage(from, {
        delete: {
          remoteJid: from, fromMe: false,
          id: quoted.stanzaId, participant: quoted.participant
        }
      })
    }

    // ======================
    // OPEN GROUP
    // ======================
    if (text === ".open") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      await sock.groupSettingUpdate(from, "not_announcement")
      sock.sendMessage(from, { text: "✅ Grup dibuka" })
    }

    // ======================
    // CLOSE GROUP
    // ======================
    if (text === ".close") {
      if (!isAllowed) return sock.sendMessage(from, { text: "❌ Khusus admin & owner" })
      await sock.groupSettingUpdate(from, "announcement")
      sock.sendMessage(from, { text: "🔒 Grup ditutup" })
    }

  } catch (err) {
    console.log("Error handler:", err)
  }
}
