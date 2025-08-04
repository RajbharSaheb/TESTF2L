const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Bot initialization
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });
bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// File storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(16).toString('hex');
    cb(null, `${uniqueId}_${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB limit
});

// In-memory storage for file metadata
const fileDatabase = new Map();

// Bot commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🚀 Welcome to File Stream Bot!

📤 Simply send me any file (up to 4GB) and I'll generate:
• 🔗 Instant streaming link
• 📱 Modern web player
• ⬇️ Download option

Ready to share your files? Just send them over! ✨`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '📖 Help', callback_data: 'help' },
        { text: '📊 Stats', callback_data: 'stats' }
      ]]
    }
  });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `📖 **How to Use:**

1️⃣ Send any file to the bot
2️⃣ Get instant streaming link
3️⃣ Share the link with anyone
4️⃣ Files can be streamed or downloaded

**Supported:**
• All file types
• Up to 4GB file size
• Instant streaming
• Mobile-friendly player

**Commands:**
/start - Start the bot
/help - Show this help
/stats - Show bot statistics`, { parse_mode: 'Markdown' });
});

// Handle file uploads
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const document = msg.document;
  
  if (document.file_size > 4 * 1024 * 1024 * 1024) {
    return bot.sendMessage(chatId, '❌ File too large! Maximum size is 4GB.');
  }

  const processingMsg = await bot.sendMessage(chatId, '⏳ Processing your file...');

  try {
    const fileInfo = await bot.getFile(document.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    
    const uniqueId = crypto.randomBytes(16).toString('hex');
    
    // Store file metadata
    fileDatabase.set(uniqueId, {
      fileName: document.file_name,
      fileSize: document.file_size,
      mimeType: document.mime_type || 'application/octet-stream',
      telegramUrl: fileUrl,
      uploadTime: new Date(),
      downloads: 0
    });

    const streamUrl = `${WEBHOOK_URL}/stream/${uniqueId}`;
    
    await bot.editMessageText(`✅ **File Ready!**

📁 **${document.file_name}**
📏 Size: ${formatFileSize(document.file_size)}

🔗 **Stream Link:**
${streamUrl}

🌐 Click the link to access your file with streaming and download options!`, {
      chat_id: chatId,
      message_id: processingMsg.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🌐 Open Stream', url: streamUrl },
          { text: '📋 Copy Link', callback_data: `copy_${uniqueId}` }
        ]]
      }
    });

  } catch (error) {
    console.error('Error processing file:', error);
    bot.editMessageText('❌ Error processing file. Please try again.', {
      chat_id: chatId,
      message_id: processingMsg.message_id
    });
  }
});

// Handle other file types
bot.on('video', handleFile);
bot.on('audio', handleFile);
bot.on('photo', handleFile);
bot.on('voice', handleFile);
bot.on('video_note', handleFile);

async function handleFile(msg) {
  const chatId = msg.chat.id;
  const file = msg.video || msg.audio || msg.voice || msg.video_note || (msg.photo && msg.photo[msg.photo.length - 1]);
  
  if (!file) return;
  
  if (file.file_size > 4 * 1024 * 1024 * 1024) {
    return bot.sendMessage(chatId, '❌ File too large! Maximum size is 4GB.');
  }

  const processingMsg = await bot.sendMessage(chatId, '⏳ Processing your file...');

  try {
    const fileInfo = await bot.getFile(file.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const fileName = file.file_name || `file_${Date.now()}`;
    
    fileDatabase.set(uniqueId, {
      fileName,
      fileSize: file.file_size,
      mimeType: file.mime_type || 'application/octet-stream',
      telegramUrl: fileUrl,
      uploadTime: new Date(),
      downloads: 0
    });

    const streamUrl = `${WEBHOOK_URL}/stream/${uniqueId}`;
    
    await bot.editMessageText(`✅ **File Ready!**

📁 **${fileName}**
📏 Size: ${formatFileSize(file.file_size)}

🔗 **Stream Link:**
${streamUrl}

🌐 Click the link to access your file!`, {
      chat_id: chatId,
      message_id: processingMsg.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🌐 Open Stream', url: streamUrl },
          { text: '📋 Copy Link', callback_data: `copy_${uniqueId}` }
        ]]
      }
    });

  } catch (error) {
    console.error('Error processing file:', error);
    bot.editMessageText('❌ Error processing file. Please try again.', {
      chat_id: chatId,
      message_id: processingMsg.message_id
    });
  }
}

// Callback query handler
bot.on('callback_query', (query) => {
  const data = query.data;
  
  if (data === 'help') {
    bot.answerCallbackQuery(query.id, { text: 'Help information sent!' });
    bot.sendMessage(query.message.chat.id, `📖 **How to Use:**

1️⃣ Send any file to the bot
2️⃣ Get instant streaming link
3️⃣ Share the link with anyone
4️⃣ Files can be streamed or downloaded

**Features:**
• All file types supported
• Up to 4GB file size
• Instant streaming
• Modern web player
• Mobile-friendly`, { parse_mode: 'Markdown' });
  } else if (data === 'stats') {
    const totalFiles = fileDatabase.size;
    bot.answerCallbackQuery(query.id, { text: 'Stats loaded!' });
    bot.sendMessage(query.message.chat.id, `📊 **Bot Statistics:**

📁 Total Files: ${totalFiles}
🚀 Status: Online
💾 Storage: Active`);
  } else if (data.startsWith('copy_')) {
    const fileId = data.replace('copy_', '');
    const streamUrl = `${WEBHOOK_URL}/stream/${fileId}`;
    bot.answerCallbackQuery(query.id, { 
      text: 'Link copied to clipboard!',
      show_alert: true 
    });
  }
});

// Webhook endpoint
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Stream endpoint
app.get('/stream/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  const fileData = fileDatabase.get(fileId);
  
  if (!fileData) {
    return res.status(404).send('File not found');
  }

  // Increment download counter
  fileData.downloads++;
  
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${fileData.fileName} - Stream</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(20px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            width: 100%;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .file-icon {
            font-size: 4rem;
            color: #667eea;
            margin-bottom: 20px;
        }
        
        .file-name {
            font-size: 1.5rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 10px;
            word-break: break-all;
        }
        
        .file-info {
            color: #666;
            margin-bottom: 30px;
            font-size: 1rem;
        }
        
        .actions {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 50px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
            min-width: 140px;
            justify-content: center;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.2);
            color: #333;
            border: 2px solid rgba(102, 126, 234, 0.3);
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
        
        .stats {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid rgba(0, 0, 0, 0.1);
            color: #666;
            font-size: 0.9rem;
        }
        
        @media (max-width: 480px) {
            .container {
                padding: 30px 20px;
            }
            
            .actions {
                flex-direction: column;
            }
            
            .btn {
                width: 100%;
            }
        }
        
        .loading {
            display: none;
            color: #667eea;
            font-weight: 600;
            margin-top: 15px;
        }
        
        .media-player {
            margin: 20px 0;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="file-icon">
            <i class="${getFileIcon(fileData.mimeType)}"></i>
        </div>
        
        <h1 class="file-name">${fileData.fileName}</h1>
        
        <div class="file-info">
            <i class="fas fa-file-alt"></i> ${formatFileSize(fileData.fileSize)} • 
            <i class="fas fa-clock"></i> ${fileData.uploadTime.toLocaleDateString()} •
            <i class="fas fa-download"></i> ${fileData.downloads} downloads
        </div>
        
        ${generateMediaPlayer(fileData)}
        
        <div class="actions">
            <a href="/download/${fileId}" class="btn btn-primary" onclick="showLoading()">
                <i class="fas fa-download"></i>
                Download File
            </a>
            
            <button class="btn btn-secondary" onclick="copyLink()">
                <i class="fas fa-link"></i>
                Copy Link
            </button>
        </div>
        
        <div class="loading" id="loading">
            <i class="fas fa-spinner fa-spin"></i> Preparing download...
        </div>
        
        <div class="stats">
            <i class="fas fa-shield-alt"></i> Secure streaming powered by Telegram Bot
        </div>
    </div>
    
    <script>
        function showLoading() {
            document.getElementById('loading').style.display = 'block';
        }
        
        function copyLink() {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const btn = event.target.closest('.btn');
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                btn.style.background = '#28a745';
                
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = '';
                }, 2000);
            });
        }
    </script>
</body>
</html>
  `);
});

// Download endpoint
app.get('/download/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  const fileData = fileDatabase.get(fileId);
  
  if (!fileData) {
    return res.status(404).send('File not found');
  }
  
  try {
    const response = await fetch(fileData.telegramUrl);
    
    if (!response.ok) {
      throw new Error('Failed to fetch file');
    }
    
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Length', fileData.fileSize);
    
    response.body.pipe(res);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Error downloading file');
  }
});

// Utility functions
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(mimeType) {
  if (!mimeType) return 'fas fa-file';
  
  if (mimeType.startsWith('video/')) return 'fas fa-video';
  if (mimeType.startsWith('audio/')) return 'fas fa-music';
  if (mimeType.startsWith('image/')) return 'fas fa-image';
  if (mimeType.includes('pdf')) return 'fas fa-file-pdf';
  if (mimeType.includes('zip') || mimeType.includes('rar')) return 'fas fa-file-archive';
  if (mimeType.includes('doc')) return 'fas fa-file-word';
  if (mimeType.includes('sheet')) return 'fas fa-file-excel';
  
  return 'fas fa-file';
}

function generateMediaPlayer(fileData) {
  const mimeType = fileData.mimeType;
  
  if (mimeType && mimeType.startsWith('video/')) {
    return `
      <div class="media-player">
        <video controls width="100%" preload="metadata">
          <source src="/download/${Array.from(fileDatabase.entries()).find(([k, v]) => v === fileData)[0]}" type="${mimeType}">
          Your browser does not support video playback.
        </video>
      </div>
    `;
  }
  
  if (mimeType && mimeType.startsWith('audio/')) {
    return `
      <div class="media-player">
        <audio controls width="100%" preload="metadata">
          <source src="/download/${Array.from(fileDatabase.entries()).find(([k, v]) => v === fileData)[0]}" type="${mimeType}">
          Your browser does not support audio playback.
        </audio>
      </div>
    `;
  }
  
  return '';
}

// Health check
app.get('/', (req, res) => {
  res.send(`
    <h1>🚀 Telegram File Stream Bot</h1>
    <p>Bot is running successfully!</p>
    <p>Add your bot to Telegram and start sharing files.</p>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Bot is ready to receive files!`);
});
