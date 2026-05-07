import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import OpenAI from 'openai';
import qrcode from 'qrcode-terminal';
import express from 'express';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
app.use(express.json());

const { state, saveCreds } = await useMultiFileAuthState('auth_info');

// Histórico de conversa por chat
const chatHistory = new Map();

async function startBot() {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.process((events) => {
    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update'];
      
      if (qr) {
        console.log('Escaneie o QR Code abaixo:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Conexão fechada,', shouldReconnect ? 'reconectando...' : 'logout');
        if (shouldReconnect) startBot();
      } else if (connection === 'open') {
        console.log('✅ Bot conectado ao WhatsApp!');
      }
    }

    if (events['messages.upsert']) {
      const { messages } = events['messages.upsert'];
      for (const msg of messages) {
        if (msg.key.fromMe || !msg.message) continue;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || 
                    msg.message.extendedTextMessage?.text || 
                    msg.message.imageMessage?.caption || '';

        console.log(`Mensagem de ${from}: ${text}`);

        if (!chatHistory.has(from)) chatHistory.set(from, []);
        const history = chatHistory.get(from);
        history.push({ role: 'user', content: text });

        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Você é um assistente útil e amigável. Responda de forma natural e concisa.' },
              ...history.slice(-10)
            ],
            max_tokens: 500,
          });

          const reply = completion.choices[0].message.content;
          history.push({ role: 'assistant', content: reply });

          await sock.sendMessage(from, { text: reply });
        } catch (err) {
          console.error(err);
          await sock.sendMessage(from, { text: 'Desculpe, tive um erro ao processar sua mensagem.' });
        }
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

startBot();

app.get('/', (req, res) => res.send('WhatsApp ChatGPT Bot rodando! 🚀'));
app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT || 3000}`);
});
