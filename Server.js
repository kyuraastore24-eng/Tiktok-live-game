const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let tiktokConnection = null;

// Daftar Soal & Jawaban Tebakan
const questionList = [
    { clue: "NAMA HEWAN", display: "K _ C _ N G", answer: "KUCING" },
    { clue: "NAMA BUAH", display: "M _ N G G _", answer: "MANGGA" },
    { clue: "NAMA HEWAN", display: "K _ L I N C I", answer: "KELINCI" },
    { clue: "NAMA BENDA", display: "L _ P T _ P", answer: "LAPTOP" },
    { clue: "NAMA NEGARA", display: "J _ P _ N G", answer: "JEPANG" },
    { clue: "NAMA HEWAN", display: "G _ J _ H", answer: "GAJAH" },
    { clue: "NAMA MAKANAN", display: "B _ K S _", answer: "BAKSO" }
];

let currentQuestionIndex = 0;
let topScorers = {}; // { username: { name, score } }
let topTappers = {}; // { username: { name, likes } }
let currentCombo = 0;
let comboTimer = null;

function getCurrentQuestion() {
    return questionList[currentQuestionIndex];
}

function nextQuestion() {
    currentQuestionIndex = (currentQuestionIndex + 1) % questionList.length;
    return getCurrentQuestion();
}

function getTopList(obj, key) {
    return Object.values(obj)
        .sort((a, b) => b[key] - a[key])
        .slice(0, 7);
}

io.on('connection', (socket) => {
    // Kirim data awal saat web dibuka
    socket.emit('initGame', {
        question: getCurrentQuestion(),
        topScorers: getTopList(topScorers, 'score'),
        topTappers: getTopList(topTappers, 'likes'),
        combo: currentCombo
    });

    // Menerima perintah konek dari browser HP
    socket.on('connectTiktok', (username) => {
        if (!username) return;

        if (tiktokConnection) {
            try { tiktokConnection.disconnect(); } catch (e) {}
        }

        const cleanUser = username.replace('@', '').trim();
        tiktokConnection = new WebcastPushConnection(cleanUser);

        tiktokConnection.connect()
            .then(state => {
                socket.emit('status', `✅ Terhubung ke Live: @${cleanUser}`);
            })
            .catch(err => {
                socket.emit('status', `❌ Gagal konek: Pastikan @${cleanUser} lagi LIVE!`);
            });

        // Event: Tap-tap / Like
        tiktokConnection.on('like', data => {
            const user = data.uniqueId;
            if (!topTappers[user]) {
                topTappers[user] = { name: data.nickname || user, likes: 0 };
            }
            topTappers[user].likes += (data.likeCount || 1);

            io.emit('updateTopTappers', getTopList(topTappers, 'likes'));
        });

        // Event: Komentar Chat Penonton
        tiktokConnection.on('chat', data => {
            const comment = data.comment.trim().toUpperCase();
            const currentQ = getCurrentQuestion();

            if (comment === currentQ.answer.toUpperCase()) {
                currentCombo++;
                clearTimeout(comboTimer);
                // Reset combo jika tidak ada yang tebak benar lagi dalam 25 detik
                comboTimer = setTimeout(() => {
                    currentCombo = 0;
                    io.emit('resetCombo');
                }, 25000);

                const user = data.uniqueId;
                if (!topScorers[user]) {
                    topScorers[user] = { name: data.nickname || user, score: 0 };
                }
                topScorers[user].score += 1;

                const winnerName = data.nickname || user;
                const nextQ = nextQuestion();

                io.emit('correctAnswer', {
                    winner: winnerName,
                    combo: currentCombo,
                    topScorers: getTopList(topScorers, 'score'),
                    nextQuestion: nextQ
                });
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server siap berjalan di port ${PORT}`));
