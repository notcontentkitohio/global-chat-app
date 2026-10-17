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
  secret: 'win11_otp_fixed_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const DATA_FILE = path.join(__dirname, 'data.json');

let db = {
  users: [],
  messages: []
};

const otpStore = new Map();

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

// API TẠO VÀ GỬI OTP
app.post('/api/register-request-otp', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin!' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = db.users.find(u => u.email && u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(400).json({ error: 'Email này đã được sử dụng!' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const isOwner = cleanEmail.includes('kitchannel190882') || cleanEmail.includes('kitohio') || db.users.length === 0;

    otpStore.set(cleanEmail, {
      code: otpCode,
      tempUserData: {
        username: username.trim(),
        email: cleanEmail,
        password: bcrypt.hashSync(password, 10),
        role: isOwner ? 'owner' : 'member'
      },
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[XÁC MINH OTP] Mã xác thực cho ${cleanEmail} là: ${otpCode}`);

    return res.json({
      success: true,
      message: `Mã OTP đã tạo thành công!`,
      otp: otpCode
    });
  } catch (err) {
    console.error('Lỗi Server OTP:', err);
    return res.status(500).json({ error: 'Lỗi server khi tạo OTP' });
  }
});

// API XÁC MINH OTP
app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Vui lòng nhập mã OTP!' });

  const cleanEmail = email.toLowerCase().trim();
  const record = otpStore.get(cleanEmail);

  if (!record || Date.now() > record.expiresAt || record.code !== otp.trim()) {
    return res.status(400).json({ error: 'Mã OTP không chính xác hoặc đã hết hạn!' });
  }

  const newUser = {
    id: 'user_' + Date.now(),
    username: record.tempUserData.username,
    email: cleanEmail,
    password: record.tempUserData.password,
    role: record.tempUserData.role,
    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
    banner: '',
    bio: 'Chào mừng bạn đến với Global Chat!',
    banned: false,
    friends: []
  };

  db.users.push(newUser);
  saveData();
  otpStore.delete(cleanEmail);

  req.session.userId = newUser.id;
  const safeUser = { ...newUser };
  delete safeUser.password;
  return res.json({ success: true, user: safeUser });
});

// API ĐĂNG NHẬP
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Vui lòng nhập đầy đủ email và mật khẩu!' });

  const cleanEmail = email.toLowerCase().trim();
  const user = db.users.find(u => u.email && u.email.toLowerCase() === cleanEmail);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'Email hoặc mật khẩu không đúng!' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'Tài khoản đã bị khóa!' });
  }

  if (cleanEmail.includes('kitchannel190882') || cleanEmail.includes('kitohio')) {
    user.role = 'owner';
    saveData();
  }

  req.session.userId = user.id;
  const safeUser = { ...user };
  delete safeUser.password;
  return res.json({ success: true, user: safeUser });
});

// KÍCH HOẠT OWNER BẰNG PASSCODE
app.post('/api/claim-owner', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Chưa đăng nhập!' });
  const { secretKey } = req.body;

  if (secretKey === 'notcontentkitohio2026') {
    const user = db.users.find(u => u.id === req.session.userId);
    if (user) {
      user.role = 'owner';
      saveData();
      const safeUser = { ...user };
      delete safeUser.password;
      return res.json({ success: true, user: safeUser });
    }
  }
  return res.status(403).json({ error: 'Passcode không đúng!' });
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
  if (!user) return res.status(404).json({ error: 'User không tồn tại' });

  const { username, bio, avatar, banner } = req.body;
  if (username) user.username = username.trim();
  if (bio !== undefined) user.bio = bio.trim();
  if (avatar) user.avatar = avatar;
  if (banner !== undefined) user.banner = banner;

  saveData();
  const safeUser = { ...user };
  delete safeUser.password;
  res.json({ success: true, user: safeUser });
});

// API EDITOR VS CODE WEB
app.get('/api/editor/get-file', (req, res) => {
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || user.role !== 'owner') {
    return res.status(403).json({ error: 'Chỉ Owner mới có quyền chỉnh sửa Code!' });
  }

  const { filename } = req.query;
  const allowedFiles = ['index.html', 'server.js', 'package.json'];
  if (!allowedFiles.includes(filename)) {
    return res.status(400).json({ error: 'Tệp tin không được phép!' });
  }

  const filePath = path.join(__dirname, filename);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return res.json({ success: true, filename, content });
  }
  res.status(404).json({ error: 'Không tìm thấy file' });
});

app.post('/api/editor/save-file', (req, res) => {
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || user.role !== 'owner') {
    return res.status(403).json({ error: 'Chỉ Owner mới có quyền lưu Code!' });
  }

  const { filename, content } = req.body;
  const allowedFiles = ['index.html', 'server.js', 'package.json'];
  if (!allowedFiles.includes(filename)) {
    return res.status(400).json({ error: 'Tệp tin không được phép!' });
  }

  try {
    const filePath = path.join(__dirname, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    return res.json({ success: true, message: `Đã lưu thành công ${filename}!` });
  } catch (err) {
    return res.status(500).json({ error: 'Lỗi khi ghi file code' });
  }
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

  socket.on('send_friend_request', ({ targetUserId, fromUserId }) => {
    const target = db.users.find(u => u.id === targetUserId);
    if (target) {
      if (!target.friends) target.friends = [];
      if (!target.friends.includes(fromUserId)) {
        target.friends.push(fromUserId);
        saveData();
      }
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('update_online_list', Array.from(onlineUsers.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Global Chat Server] Đang chạy tại cổng ${PORT}`);
});