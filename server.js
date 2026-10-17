const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

app.use(session({
  secret: 'win11_persistent_chat_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// TỰ ĐỘNG ĐỌC/GHĨ FILE DATA.JSON ĐỂ BẢO VỆ DỮ LIỆU
const DATA_FILE = path.join(__dirname, 'data.json');

let db = {
  users: [],       // { id, username, email, password, avatar, bio, friends: [], friendRequests: [] }
  messages: []     // { id, userId, user, avatar, text, timestamp }
};

// Đọc dữ liệu từ file nếu tồn tại
if (fs.existsSync(DATA_FILE)) {
  try {
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    db = JSON.parse(rawData);
    if (!db.users) db.users = [];
    if (!db.messages) db.messages = [];
  } catch (err) {
    console.error("Lỗi đọc file data.json, tạo mới dữ liệu", err);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Lỗi ghi file data.json", err);
  }
}

// REST APIs
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin!' });
  }

  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  if (existing) {
    return res.status(400).json({ error: 'Email này đã được sử dụng!' });
  }

  const newUser = {
    id: 'user_' + Date.now(),
    username: username.trim(),
    email: email.toLowerCase().trim(),
    password: bcrypt.hashSync(password, 10),
    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
    bio: 'Chào bạn, mình đang xài Global Chat!',
    friends: [],
    friendRequests: []
  };

  db.users.push(newUser);
  saveData();

  req.session.userId = newUser.id;
  const safeUser = { ...newUser };
  delete safeUser.password;
  return res.json({ success: true, user: safeUser });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'Email hoặc mật khẩu không chính xác!' });
  }

  req.session.userId = user.id;
  const safeUser = { ...user };
  delete safeUser.password;
  return res.json({ success: true, user: safeUser });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json(null);
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.json(null);

  const safeUser = { ...user };
  delete safeUser.password;
  res.json(safeUser);
});

app.post('/api/update-profile', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Chưa đăng nhập!' });
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

  const { username, bio, avatar } = req.body;
  if (username) user.username = username.trim();
  if (bio !== undefined) user.bio = bio.trim();
  if (avatar) user.avatar = avatar;

  saveData();
  const safeUser = { ...user };
  delete safeUser.password;
  res.json({ success: true, user: safeUser });
});

app.get('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e7 });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Realtime Socket.io logic
io.on('connection', (socket) => {
  socket.emit('load_history', db.messages);

  socket.on('send_message', (data) => {
    const msg = {
      id: 'msg_' + Date.now(),
      userId: data.userId,
      user: data.user,
      avatar: data.avatar,
      text: data.text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    db.messages.push(msg);
    if (db.messages.length > 60) db.messages.shift();
    saveData();
    io.emit('receive_message', msg);
  });

  // Hệ thống kết bạn realtime
  socket.on('send_friend_request', ({ targetUserId, fromUserId }) => {
    const target = db.users.find(u => u.id === targetUserId);
    const from = db.users.find(u => u.id === fromUserId);

    if (target && from) {
      if (!target.friendRequests) target.friendRequests = [];
      if (!target.friends) target.friends = [];

      if (!target.friends.includes(fromUserId) && !target.friendRequests.includes(fromUserId)) {
        target.friendRequests.push(fromUserId);
        saveData();
        io.emit('friend_request_updated', { targetUserId });
      }
    }
  });

  socket.on('accept_friend_request', ({ fromUserId, currentUserId }) => {
    const user = db.users.find(u => u.id === currentUserId);
    const friend = db.users.find(u => u.id === fromUserId);

    if (user && friend) {
      user.friendRequests = (user.friendRequests || []).filter(id => id !== fromUserId);
      if (!user.friends) user.friends = [];
      if (!friend.friends) friend.friends = [];

      if (!user.friends.includes(fromUserId)) user.friends.push(fromUserId);
      if (!friend.friends.includes(currentUserId)) friend.friends.push(currentUserId);

      saveData();
      io.emit('friend_status_changed', { user1: currentUserId, user2: fromUserId });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Persistent Server] Server Windows 11 đang chạy tại cổng ${PORT}`);
});