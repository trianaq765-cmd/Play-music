// ==========================================
// DISCORD MUSIC BOT - RENDER VERSION
// ==========================================

const express = require('express');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder
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
// EXPRESS SERVER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

let botReady = false;

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Discord Music Bot</title>
            <style>
                body { font-family: Arial; background: #2c2f33; color: #fff; padding: 50px; text-align: center; }
                .status { font-size: 24px; margin: 20px; }
                .online { color: #43b581; }
                .offline { color: #f04747; }
            </style>
        </head>
        <body>
            <h1>🎵 Discord Music Bot</h1>
            <div class="status ${botReady ? 'online' : 'offline'}">
                Status: ${botReady ? '🟢 Online' : '🔴 Offline'}
            </div>
            <p>Uptime: ${Math.floor(process.uptime())} detik</p>
            <p>Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</p>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: botReady ? 'online' : 'starting',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Server berjalan di port ${PORT}`);
});

// ==========================================
// DISCORD BOT
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

const queue = new Map();
const PREFIX = '!';

// ==========================================
// ERROR HANDLERS
// ==========================================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
});

// ==========================================
// BOT READY
// ==========================================
client.once('ready', () => {
    console.log(`✅ Bot ${client.user.tag} online!`);
    botReady = true;
    client.user.setActivity('🎵 !help', { type: 2 });
});

// ==========================================
// MESSAGE HANDLER
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // COMMAND: HELP
    if (command === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('🎵 Daftar Perintah')
            .addFields(
                { name: '!play <judul/url>', value: 'Putar musik', inline: false },
                { name: '!skip', value: 'Skip lagu', inline: true },
                { name: '!stop', value: 'Stop & keluar', inline: true },
                { name: '!pause', value: 'Pause musik', inline: true },
                { name: '!resume', value: 'Resume musik', inline: true },
                { name: '!queue', value: 'Lihat antrian', inline: true },
                { name: '!np', value: 'Now playing', inline: true },
                { name: '!ping', value: 'Cek latency', inline: true }
            )
            .setTimestamp();

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // COMMAND: PING
    if (command === 'ping') {
        const sent = await message.reply('🏓 Pinging...');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        sent.edit(`🏓 Pong!\n⏱️ Latency: ${latency}ms\n💓 API: ${Math.round(client.ws.ping)}ms`);
        return;
    }

    // COMMAND: PLAY
    if (command === 'play' || command === 'p') {
        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply('❌ Kamu harus masuk ke Voice Channel!');
        }

        const permissions = voiceChannel.permissionsFor(message.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return message.reply('❌ Bot butuh permission Connect dan Speak!');
        }

        const searchQuery = args.join(' ');
        if (!searchQuery) {
            return message.reply('❌ Contoh: `!play never gonna give you up`');
        }

        const loadingMsg = await message.channel.send('🔍 Mencari...');

        try {
            console.log('🔍 Searching:', searchQuery);

            let songInfo;
            const isYouTubeUrl = play.yt_validate(searchQuery) === 'video';
            
            if (isYouTubeUrl) {
                songInfo = await play.video_info(searchQuery);
            } else {
                const searchResult = await play.search(searchQuery, { limit: 1 });
                if (searchResult.length === 0) {
                    return loadingMsg.edit('❌ Tidak ditemukan!');
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

            const serverQueue = queue.get(message.guild.id);

            if (serverQueue) {
                serverQueue.songs.push(song);
                const addedEmbed = new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('✅ Ditambahkan ke Queue')
                    .setDescription(`**[${song.title}](${song.url})**`)
                    .addFields(
                        { name: 'Durasi', value: song.duration, inline: true },
                        { name: 'Posisi', value: `#${serverQueue.songs.length}`, inline: true }
                    )
                    .setThumbnail(song.thumbnail);

                return loadingMsg.edit({ content: '', embeds: [addedEmbed] });
            }

            const queueConstruct = {
                textChannel: message.channel,
                voiceChannel: voiceChannel,
                connection: null,
                player: createAudioPlayer(),
                songs: [song],
                playing: true
            };

            queue.set(message.guild.id, queueConstruct);

            try {
                console.log('🔌 Connecting...');
                
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator
                });

                queueConstruct.connection = connection;

                await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
                console.log('✅ Connected!');

                connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
                        ]);
                    } catch (error) {
                        connection.destroy();
                        queue.delete(message.guild.id);
                    }
                });

                await playSong(message.guild.id, queueConstruct.songs[0]);
                loadingMsg.delete().catch(() => {});

            } catch (error) {
                console.error('❌ Connection error:', error);
                queue.delete(message.guild.id);
                return loadingMsg.edit('❌ Tidak bisa join VC!');
            }

        } catch (error) {
            console.error('❌ Play error:', error);
            queue.delete(message.guild.id);
            
            let errorMessage = '❌ Terjadi error!';
            if (error.message.includes('Sign in')) {
                errorMessage = '❌ YouTube rate limit. Tunggu beberapa menit.';
            }
            
            return loadingMsg.edit(errorMessage);
        }
    }

    // COMMAND: SKIP
    if (command === 'skip' || command === 's') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue) return message.reply('❌ Tidak ada lagu!');
        if (!message.member.voice.channel) return message.reply('❌ Join VC dulu!');

        serverQueue.player.stop();
        message.react('⏭️').catch(() => {});
    }

    // COMMAND: STOP
    if (command === 'stop' || command === 'leave') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue) return message.reply('❌ Tidak ada lagu!');
        if (!message.member.voice.channel) return message.reply('❌ Join VC dulu!');

        serverQueue.songs = [];
        serverQueue.player.stop();
        if (serverQueue.connection) serverQueue.connection.destroy();
        queue.delete(message.guild.id);
        
        message.reply('👋 Bye!');
    }

    // COMMAND: PAUSE
    if (command === 'pause') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue || !serverQueue.playing) return message.reply('❌ Tidak ada lagu!');

        serverQueue.player.pause();
        serverQueue.playing = false;
        message.react('⏸️').catch(() => {});
    }

    // COMMAND: RESUME
    if (command === 'resume') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue) return message.reply('❌ Tidak ada lagu!');

        serverQueue.player.unpause();
        serverQueue.playing = true;
        message.react('▶️').catch(() => {});
    }

    // COMMAND: QUEUE
    if (command === 'queue' || command === 'q') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.reply('❌ Queue kosong!');
        }

        const songList = serverQueue.songs
            .slice(0, 10)
            .map((song, index) => {
                if (index === 0) {
                    return `🎵 **Now:** [${song.title}](${song.url}) \`${song.duration}\``;
                }
                return `**${index}.** [${song.title}](${song.url}) \`${song.duration}\``;
            })
            .join('\n');

        const queueEmbed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle('📜 Queue')
            .setDescription(songList)
            .setFooter({ text: `Total: ${serverQueue.songs.length}` });

        message.channel.send({ embeds: [queueEmbed] });
    }

    // COMMAND: NOW PLAYING
    if (command === 'nowplaying' || command === 'np') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.reply('❌ Tidak ada lagu!');
        }

        const song = serverQueue.songs[0];
        const npEmbed = new EmbedBuilder()
            .setColor('#e74c3c')
            .setTitle('🎵 Now Playing')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
                { name: 'Durasi', value: song.duration, inline: true },
                { name: 'Diminta', value: song.requestedBy, inline: true }
            )
            .setThumbnail(song.thumbnail);

        message.channel.send({ embeds: [npEmbed] });
    }
});

// ==========================================
// PLAY SONG FUNCTION
// ==========================================
async function playSong(guildId, song) {
    const serverQueue = queue.get(guildId);

    if (!song) {
        setTimeout(() => {
            if (serverQueue && serverQueue.connection) {
                serverQueue.connection.destroy();
            }
            queue.delete(guildId);
        }, 60000);
        return;
    }

    try {
        console.log('🎵 Playing:', song.title);

        const stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true
        });

        if (resource.volume) {
            resource.volume.setVolume(0.5);
        }

        serverQueue.player.play(resource);
        serverQueue.connection.subscribe(serverQueue.player);

        const playEmbed = new EmbedBuilder()
            .setColor('#1DB954')
            .setTitle('🎵 Now Playing')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
                { name: 'Durasi', value: song.duration, inline: true },
                { name: 'Diminta', value: song.requestedBy, inline: true }
            )
            .setThumbnail(song.thumbnail);

        serverQueue.textChannel.send({ embeds: [playEmbed] });

        serverQueue.player.once(AudioPlayerStatus.Idle, () => {
            console.log('⏭️ Next song');
            serverQueue.songs.shift();
            playSong(guildId, serverQueue.songs[0]);
        });

        serverQueue.player.on('error', (error) => {
            console.error('❌ Player error:', error);
            serverQueue.textChannel.send('❌ Error! Skipping...');
            serverQueue.songs.shift();
            playSong(guildId, serverQueue.songs[0]);
        });

    } catch (error) {
        console.error('❌ Play error:', error);
        serverQueue.textChannel.send('❌ Error playing!');
        serverQueue.songs.shift();
        
        if (serverQueue.songs.length > 0) {
            setTimeout(() => playSong(guildId, serverQueue.songs[0]), 2000);
        } else {
            if (serverQueue.connection) serverQueue.connection.destroy();
            queue.delete(guildId);
        }
    }
}

// ==========================================
// LOGIN
// ==========================================
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Login failed:', error);
    process.exit(1);
});
