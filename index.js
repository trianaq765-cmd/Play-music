// ==========================================
// DISCORD MUSIC BOT - RENDER + UPTIMEROBOT
// ==========================================

const express = require('express');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const play = require('play-dl');

// ==========================================
// EXPRESS SERVER (Anti-Sleep)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send(`
        <h1>🎵 Bot Musik Discord</h1>
        <p>Status: Online</p>
        <p>Uptime: ${Math.floor(process.uptime())} detik</p>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Server Express berjalan di port ${PORT}`);
});

// ==========================================
// DISCORD BOT SETUP
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// Queue musik per server
const queue = new Map();

// Prefix command
const PREFIX = '!';

// ==========================================
// BOT READY EVENT
// ==========================================
client.once('ready', () => {
    console.log(`✅ Bot ${client.user.tag} online!`);
    client.user.setActivity('🎵 !help untuk bantuan', { type: 2 });
});

// ==========================================
// MESSAGE HANDLER
// ==========================================
client.on('messageCreate', async (message) => {
    // Ignore bot dan pesan tanpa prefix
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ========== COMMAND: HELP ==========
    if (command === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('🎵 Daftar Perintah Bot Musik')
            .setDescription('Berikut adalah perintah yang tersedia:')
            .addFields(
                { name: '`!play <judul/url>`', value: 'Putar musik dari YouTube', inline: false },
                { name: '`!skip`', value: 'Skip ke lagu berikutnya', inline: true },
                { name: '`!stop`', value: 'Hentikan musik & keluar', inline: true },
                { name: '`!pause`', value: 'Pause musik', inline: true },
                { name: '`!resume`', value: 'Lanjutkan musik', inline: true },
                { name: '`!queue`', value: 'Lihat antrian musik', inline: true },
                { name: '`!nowplaying`', value: 'Lagu yang sedang diputar', inline: true }
            )
            .setFooter({ text: 'Bot Musik Discord 🎶' })
            .setTimestamp();

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // ========== COMMAND: PLAY ==========
    if (command === 'play' || command === 'p') {
        const voiceChannel = message.member.voice.channel;

        // Cek apakah user di voice channel
        if (!voiceChannel) {
            return message.reply('❌ Kamu harus masuk ke Voice Channel dulu!');
        }

        // Cek permission bot
        const permissions = voiceChannel.permissionsFor(message.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return message.reply('❌ Saya butuh permission untuk Connect dan Speak!');
        }

        // Cek apakah ada query
        const searchQuery = args.join(' ');
        if (!searchQuery) {
            return message.reply('❌ Masukkan judul lagu atau URL YouTube!\nContoh: `!play never gonna give you up`');
        }

        // Kirim pesan loading
        const loadingMsg = await message.channel.send('🔍 Mencari lagu...');

        try {
            let songInfo;
            let stream;

            // Cek apakah URL atau search query
            if (play.yt_validate(searchQuery) === 'video') {
                // Jika URL YouTube
                songInfo = await play.video_info(searchQuery);
            } else {
                // Jika search query
                const searchResult = await play.search(searchQuery, { limit: 1 });
                if (searchResult.length === 0) {
                    return loadingMsg.edit('❌ Lagu tidak ditemukan!');
                }
                songInfo = await play.video_info(searchResult[0].url);
            }

            const song = {
                title: songInfo.video_details.title,
                url: songInfo.video_details.url,
                duration: songInfo.video_details.durationRaw,
                thumbnail: songInfo.video_details.thumbnails[0]?.url,
                requestedBy: message.author.tag
            };

            // Cek apakah sudah ada queue untuk server ini
            const serverQueue = queue.get(message.guild.id);

            if (serverQueue) {
                // Tambah ke queue
                serverQueue.songs.push(song);

                const addedEmbed = new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('✅ Ditambahkan ke Antrian')
                    .setDescription(`**[${song.title}](${song.url})**`)
                    .addFields(
                        { name: 'Durasi', value: song.duration, inline: true },
                        { name: 'Posisi', value: `#${serverQueue.songs.length}`, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setFooter({ text: `Diminta oleh ${song.requestedBy}` });

                return loadingMsg.edit({ content: '', embeds: [addedEmbed] });
            }

            // Buat queue baru
            const queueConstruct = {
                textChannel: message.channel,
                voiceChannel: voiceChannel,
                connection: null,
                player: createAudioPlayer(),
                songs: [song],
                playing: true
            };

            queue.set(message.guild.id, queueConstruct);

            // Join voice channel
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });

            queueConstruct.connection = connection;

            // Handle connection ready
            connection.on(VoiceConnectionStatus.Ready, () => {
                console.log('✅ Voice connection ready!');
            });

            // Handle disconnect
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5000)
                    ]);
                } catch (error) {
                    connection.destroy();
                    queue.delete(message.guild.id);
                }
            });

            // Mulai putar
            await playSong(message.guild.id, queueConstruct.songs[0]);
            loadingMsg.delete().catch(() => {});

        } catch (error) {
            console.error('Error play command:', error);
            loadingMsg.edit('❌ Terjadi error saat memutar lagu!');
            queue.delete(message.guild.id);
        }
    }

    // ========== COMMAND: SKIP ==========
    if (command === 'skip' || command === 's') {
        const serverQueue = queue.get(message.guild.id);

        if (!serverQueue) {
            return message.reply('❌ Tidak ada lagu yang diputar!');
        }

        if (!message.member.voice.channel) {
            return message.reply('❌ Kamu harus di Voice Channel!');
        }

        serverQueue.player.stop();
        message.react('⏭️');
    }

    // ========== COMMAND: STOP ==========
    if (command === 'stop' || command === 'leave' || command === 'dc') {
        const serverQueue = queue.get(message.guild.id);

        if (!serverQueue) {
            return message.reply('❌ Tidak ada lagu yang diputar!');
        }

        serverQueue.songs = [];
        serverQueue.player.stop();
        serverQueue.connection.destroy();
        queue.delete(message.guild.id);

        message.reply('👋 Bot keluar dari Voice Channel!');
    }

    // ========== COMMAND: PAUSE ==========
    if (command === 'pause') {
        const serverQueue = queue.get(message.guild.id);

        if (!serverQueue || !serverQueue.playing) {
            return message.reply('❌ Tidak ada lagu yang diputar!');
        }

        serverQueue.player.pause();
        serverQueue.playing = false;
        message.react('⏸️');
    }

    // ========== COMMAND: RESUME ==========
    if (command === 'resume') {
        const serverQueue = queue.get(message.guild.id);

        if (!serverQueue) {
            return message.reply('❌ Tidak ada lagu di queue!');
        }

        serverQueue.player.unpause();
        serverQueue.playing = true;
        message.react('▶️');
    }

    // ========== COMMAND: QUEUE ==========
    if (command === 'queue' || command === 'q') {
        const serverQueue = queue.get(message.guild.id);

        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.reply('❌ Antrian kosong!');
        }

        const songList = serverQueue.songs
            .slice(0, 10)
            .map((song, index) => {
                if (index === 0) {
                    return `🎵 **Sedang Diputar:** [${song.title}](${song.url}) - \`${song.duration}\``;
                }
                return `**${index}.** [${song.title}](${song.url}) - \`${song.duration}\``;
            })
            .join('\n\n');

        const queueEmbed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle('📜 Antrian Musik')
            .setDescription(songList)
            .setFooter({ text: `Total: ${serverQueue.songs.length} lagu` });

        message.channel.send({ embeds: [queueEmbed] });
    }

    // ========== COMMAND: NOW PLAYING ==========
    if (command === 'nowplaying' || command === 'np') {
        const serverQueue = queue.get(message.guild.id);

        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.reply('❌ Tidak ada lagu yang diputar!');
        }

        const song = serverQueue.songs[0];

        const npEmbed = new EmbedBuilder()
            .setColor('#e74c3c')
            .setTitle('🎵 Sedang Diputar')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
                { name: 'Durasi', value: song.duration, inline: true },
                { name: 'Diminta oleh', value: song.requestedBy, inline: true }
            )
            .setThumbnail(song.thumbnail);

        message.channel.send({ embeds: [npEmbed] });
    }
});

// ==========================================
// FUNGSI PUTAR LAGU
// ==========================================
async function playSong(guildId, song) {
    const serverQueue = queue.get(guildId);

    if (!song) {
        // Queue habis
        setTimeout(() => {
            if (serverQueue.connection) {
                serverQueue.connection.destroy();
            }
            queue.delete(guildId);
        }, 60000); // Tunggu 1 menit sebelum disconnect
        return;
    }

    try {
        // Dapatkan stream audio
        const stream = await play.stream(song.url);

        // Buat audio resource
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type
        });

        // Putar audio
        serverQueue.player.play(resource);
        serverQueue.connection.subscribe(serverQueue.player);

        // Kirim embed Now Playing
        const playEmbed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle('🎵 Sedang Memutar')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
                { name: 'Durasi', value: song.duration, inline: true },
                { name: 'Diminta oleh', value: song.requestedBy, inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setTimestamp();

        serverQueue.textChannel.send({ embeds: [playEmbed] });

        // Handle ketika lagu selesai
        serverQueue.player.on(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift(); // Hapus lagu yang sudah selesai
            playSong(guildId, serverQueue.songs[0]); // Putar lagu berikutnya
        });

        // Handle error
        serverQueue.player.on('error', (error) => {
            console.error('Audio Player Error:', error);
            serverQueue.songs.shift();
            playSong(guildId, serverQueue.songs[0]);
        });

    } catch (error) {
        console.error('Error playing song:', error);
        serverQueue.textChannel.send('❌ Error memutar lagu, skip ke berikutnya...');
        serverQueue.songs.shift();
        playSong(guildId, serverQueue.songs[0]);
    }
}

// ==========================================
// LOGIN BOT
// ==========================================
client.login(process.env.DISCORD_TOKEN);
