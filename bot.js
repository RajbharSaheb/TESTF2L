const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Bot Configuration
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE';
const WEBAPP_URL = 'https://your-domain.com'; // Replace with your domain
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

// In-memory storage for file info (use Redis in production)
const fileStorage = new Map();

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Generate unique file ID
function generateFileId() {
  return crypto.randomBytes(16).toString('hex');
}

// Bot message handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.document || msg.video || msg.audio || msg.photo) {
    try {
      let file, fileName, fileSize;
      
      if (msg.document) {
        file = msg.document;
        fileName = file.file_name || 'document';
        fileSize = file.file_size;
      } else if (msg.video) {
        file = msg.video;
        fileName = `video_${Date.now()}.mp4`;
        fileSize = file.file_size;
      } else if (msg.audio) {
        file = msg.audio;
        fileName = file.title || `audio_${Date.now()}.mp3`;
        fileSize = file.file_size;
      } else if (msg.photo) {
        file = msg.photo[msg.photo.length - 1];
        fileName = `photo_${Date.now()}.jpg`;
        fileSize = file.file_size;
      }
      
      // Check file size (4GB limit)
      if (fileSize > 4 * 1024 * 1024 * 1024) {
        return bot.sendMessage(chatId, '❌ File size exceeds 4GB limit!');
      }
      
      // Generate unique ID and store file info
      const fileId = generateFileId();
      const fileInfo = {
        telegramFileId: file.file_id,
        fileName: fileName,
        fileSize: fileSize,
        mimeType: file.mime_type || 'application/octet-stream',
        uploadedAt: new Date(),
        chatId: chatId
      };
      
      fileStorage.set(fileId, fileInfo);
      
      // Generate links
      const streamLink = `${WEBAPP_URL}/stream/${fileId}`;
      const webPageLink = `${WEBAPP_URL}/file/${fileId}`;
      
      // Send response with inline keyboard
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎬 Stream', url: streamLink },
              { text: '📱 Web Page', url: webPageLink }
            ],
            [
              { text: '📋 Copy Stream Link', callback_data: `copy_stream_${fileId}` },
              { text: '📋 Copy Web Link', callback_data: `copy_web_${fileId}` }
            ]
          ]
        }
      };
      
      const message = `✅ File uploaded successfully!\n\n` +
                     `📁 **File:** ${fileName}\n` +
                     `📏 **Size:** ${formatFileSize(fileSize)}\n` +
                     `🔗 **Stream Link:** ${streamLink}\n` +
                     `🌐 **Web Page:** ${webPageLink}`;
      
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        ...keyboard
      });
      
    } catch (error) {
      console.error('Error processing file:', error);
      bot.sendMessage(chatId, '❌ Error processing file. Please try again.');
    }
  } else if (msg.text === '/start') {
    const welcomeMessage = `🤖 **File Streaming Bot**\n\n` +
                          `Send me any file (up to 4GB) and I'll generate:\n` +
                          `• 🎬 Direct stream link\n` +
                          `• 🌐 Professional web page\n` +
                          `• 📥 Download option\n\n` +
                          `Supported formats: Videos, Documents, Audio, Images`;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  }
});

// Callback query handler
bot.on('callback_query', (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  
  if (data.startsWith('copy_stream_')) {
    const fileId = data.replace('copy_stream_', '');
    const streamLink = `${WEBAPP_URL}/stream/${fileId}`;
    bot.sendMessage(chatId, `📋 Stream Link:\n\`${streamLink}\``, { parse_mode: 'Markdown' });
  } else if (data.startsWith('copy_web_')) {
    const fileId = data.replace('copy_web_', '');
    const webLink = `${WEBAPP_URL}/file/${fileId}`;
    bot.sendMessage(chatId, `📋 Web Page Link:\n\`${webLink}\``, { parse_mode: 'Markdown' });
  }
  
  bot.answerCallbackQuery(callbackQuery.id);
});

// Web routes
app.get('/file/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const fileInfo = fileStorage.get(fileId);
  
  if (!fileInfo) {
    return res.status(404).send('File not found');
  }
  
  const html = generateWebPage(fileId, fileInfo);
  res.send(html);
});

app.get('/stream/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  const fileInfo = fileStorage.get(fileId);
  
  if (!fileInfo) {
    return res.status(404).send('File not found');
  }
  
  try {
    const fileUrl = await bot.getFileLink(fileInfo.telegramFileId);
    
    // Set appropriate headers for streaming
    res.setHeader('Content-Type', fileInfo.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileInfo.fileName}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Proxy the file stream
    const https = require('https');
    const http = require('http');
    const protocol = fileUrl.startsWith('https:') ? https : http;
    
    protocol.get(fileUrl, (fileStream) => {
      fileStream.pipe(res);
    }).on('error', (error) => {
      console.error('Stream error:', error);
      res.status(500).send('Stream error');
    });
    
  } catch (error) {
    console.error('Error getting file link:', error);
    res.status(500).send('Error streaming file');
  }
});

app.get('/download/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  const fileInfo = fileStorage.get(fileId);
  
  if (!fileInfo) {
    return res.status(404).send('File not found');
  }
  
  try {
    const fileUrl = await bot.getFileLink(fileInfo.telegramFileId);
    
    // Set download headers
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    // Proxy the file download
    const https = require('https');
    const http = require('http');
    const protocol = fileUrl.startsWith('https:') ? https : http;
    
    protocol.get(fileUrl, (fileStream) => {
      fileStream.pipe(res);
    }).on('error', (error) => {
      console.error('Download error:', error);
      res.status(500).send('Download error');
    });
    
  } catch (error) {
    console.error('Error getting file link:', error);
    res.status(500).send('Error downloading file');
  }
});

// API endpoint for file info
app.get('/api/file/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const fileInfo = fileStorage.get(fileId);
  
  if (!fileInfo) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.json({
    fileName: fileInfo.fileName,
    fileSize: fileInfo.fileSize,
    fileSizeFormatted: formatFileSize(fileInfo.fileSize),
    mimeType: fileInfo.mimeType,
    uploadedAt: fileInfo.uploadedAt
  });
});

// Utility function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Generate modern web page HTML
function generateWebPage(fileId, fileInfo) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${fileInfo.fileName} - File Stream</title>
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
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            max-width: 600px;
            width: 100%;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        
        .file-icon {
            font-size: 4rem;
            margin-bottom: 20px;
            color: #667eea;
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
        
        .buttons {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
            margin-bottom: 30px;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 10px;
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
            background: linear-gradient(45deg, #667eea, #764ba2);
            color: white;
        }
        
        .btn-secondary {
            background: #f8f9fa;
            color: #333;
            border: 2px solid #e9ecef;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
        }
        
        .progress-container {
            display: none;
            margin-top: 20px;
        }
        
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(45deg, #667eea, #764ba2);
            transition: width 0.3s ease;
            width: 0%;
        }
        
        .share-section {
            margin-top: 30px;
            padding-top: 30px;
            border-top: 1px solid #e9ecef;
        }
        
        .share-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 15px;
        }
        
        .share-buttons {
            display: flex;
            gap: 10px;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .share-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .copy-btn {
            background: #28a745;
            color: white;
        }
        
        .copy-btn:hover {
            background: #218838;
        }
        
        @media (max-width: 480px) {
            .container {
                padding: 30px 20px;
            }
            
            .buttons {
                flex-direction: column;
            }
            
            .btn {
                width: 100%;
            }
        }
        
        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            display: none;
            z-index: 1000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="file-icon">📁</div>
        <h1 class="file-name">${fileInfo.fileName}</h1>
        <div class="file-info">
            Size: ${formatFileSize(fileInfo.fileSize)} • 
            Uploaded: ${new Date(fileInfo.uploadedAt).toLocaleDateString()}
        </div>
        
        <div class="buttons">
            <a href="/stream/${fileId}" class="btn btn-primary" target="_blank">
                🎬 Stream File
            </a>
            <a href="/download/${fileId}" class="btn btn-secondary">
                📥 Download
            </a>
        </div>
        
        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill"></div>
            </div>
        </div>
        
        <div class="share-section">
            <div class="share-title">Share Links</div>
            <div class="share-buttons">
                <button class="share-btn copy-btn" onclick="copyToClipboard('/stream/${fileId}', 'Stream')">
                    📋 Copy Stream Link
                </button>
                <button class="share-btn copy-btn" onclick="copyToClipboard(window.location.href, 'Page')">
                    📋 Copy Page Link
                </button>
            </div>
        </div>
    </div>
    
    <div class="toast" id="toast"></div>
    
    <script>
        function copyToClipboard(text, type) {
            const fullUrl = window.location.origin + text;
            navigator.clipboard.writeText(fullUrl).then(() => {
                showToast(type + ' link copied to clipboard!');
            }).catch(err => {
                console.error('Failed to copy: ', err);
                showToast('Failed to copy link');
            });
        }
        
        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.style.display = 'block';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 3000);
        }
        
        // Add file type specific icon
        const fileName = '${fileInfo.fileName}'.toLowerCase();
        const fileIcon = document.querySelector('.file-icon');
        
        if (fileName.includes('.mp4') || fileName.includes('.avi') || fileName.includes('.mov')) {
            fileIcon.textContent = '🎬';
        } else if (fileName.includes('.mp3') || fileName.includes('.wav') || fileName.includes('.flac')) {
            fileIcon.textContent = '🎵';
        } else if (fileName.includes('.jpg') || fileName.includes('.png') || fileName.includes('.gif')) {
            fileIcon.textContent = '🖼️';
        } else if (fileName.includes('.pdf')) {
            fileIcon.textContent = '📄';
        } else if (fileName.includes('.zip') || fileName.includes('.rar')) {
            fileIcon.textContent = '📦';
        } else {
            fileIcon.textContent = '📁';
        }
    </script>
</body>
</html>`;
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Bot is active and listening for files...`);
});

module.exports = { app, bot };
