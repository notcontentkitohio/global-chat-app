const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Tăng dung lượng nhận dữ liệu Base64 ảnh upload
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7 // 10MB
});

let messageHistory = [];

app.get('/api/me', (req, res) => {
  res.json({
    id: "9999",
    username: "notcontentkitohio",
    avatar: "https://cdn.discordapp.com/embed/avatars/0.png"
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('load_history', messageHistory);

  socket.on('send_message', (data) => {
    messageHistory.push(data);
    if (messageHistory.length > 50) {
      messageHistory.shift();
    }
    io.emit('receive_message', data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy tại: http://localhost:${PORT}`);
});