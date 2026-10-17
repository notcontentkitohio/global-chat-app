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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(session({
  secret: 'win11_ultimate_chat_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const DATA_FILE = path.join(__dirname, 'data.json');

let db = {
  users: [],
  messages: []
};

if (fs.existsSync(DATA_FILE)) {
  try {
    const rawData = fs.readFileSync(DATA_FILE, 'utf8');
    db = JSON.parse(rawData);
    if (!db.users) db.users = [];
    if (!db.messages) db.messages = [];
  } catch (err) {
    console.error("Lỗi đọc file data.json", err);
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
    return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
  }

  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  if (existing) {
    return res.status(400).json({ error: 'Email này đã được đăng ký!' });
  }

  const isOwner = db.users.length === 0 || email.toLowerCase().includes('kitohio');
  const role = isOwner ? 'owner' : 'member';

  const newUser = {
    id: 'user_' + Date.now(),
    username: username.trim(),
    email: email.toLowerCase().trim(),
    password: bcrypt.hashSync(password, 10),
    role: role,
    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
    banner: '',
    decoration: 'none',
    bio: 'Chào mừng bạn đến với Global Chat!',
    banned: false,
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
    return res.status(400).json({ error: 'Email hoặc mật khẩu không đúng!' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'Tài khoản đã bị khóa!' });
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

  const { username, bio, avatar, banner, decoration } = req.body;
  if (username) user.username = username.trim();
  if (bio !== undefined) user.bio = bio.trim();
  if (avatar) user.avatar = avatar;
  if (banner !== undefined) user.banner = banner;
  if (decoration) user.decoration = decoration;

  saveData();
  const safeUser = { ...user };
  delete safeUser.password;
  res.json({ success: true, user: safeUser });
});

app.get('/api/admin/users', (req, res) => {
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || (user.role !== 'owner' && user.role !== 'mod')) {
    return res.status(403).json({ error: 'Không có quyền truy cập!' });
  }

  const safeUsersList = db.users.map(u => {
    const clone = { ...u };
    delete clone.password;
    return clone;
  });
  res.json(safeUsersList);
});

app.post('/api/admin/change-role', (req, res) => {
  const admin = db.users.find(u => u.id === req.session.userId);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Chỉ Owner mới có quyền đổi vai trò!' });
  }

  const { targetUserId, newRole } = req.body;
  const target = db.users.find(u => u.id === targetUserId);
  if (target) {
    target.role = newRole;
    saveData();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Không tìm thấy user' });
});

app.post('/api/admin/toggle-ban', (req, res) => {
  const admin = db.users.find(u => u.id === req.session.userId);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'mod')) {
    return res.status(403).json({ error: 'Không có quyền!' });
  }

  const { targetUserId } = req.body;
  const target = db.users.find(u => u.id === targetUserId);
  if (target && target.role !== 'owner') {
    target.banned = !target.banned;
    saveData();
    return res.json({ success: true, banned: target.banned });
  }
  res.status(400).json({ error: 'Không thể khóa Owner' });
});

app.get('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 5e7 });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.emit('load_history', db.messages);

  socket.on('user_online', (userData) => {
    if (userData) {
      onlineUsers.set(socket.id, userData);
      io.emit('update_online_list', Array.from(onlineUsers.values()));
    }
  });

  socket.on('send_message', (data) => {
    const msg = {
      id: 'msg_' + Date.now(),
      userId: data.userId,
      user: data.user,
      role: data.role || 'member',
      avatar: data.avatar,
      decoration: data.decoration || 'none',
      text: data.text,
      replyTo: data.replyTo || null,
      attachment: data.attachment || null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    db.messages.push(msg);
    if (db.messages.length > 80) db.messages.shift();
    saveData();
    io.emit('receive_message', msg);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('update_online_list', Array.from(onlineUsers.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Ultimate Server] Đang chạy tại cổng ${PORT}`);
});