const OpenAI = require('openai');
const logger = require('../utils/logger');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function transcribeAudio(buffer) {
  try {
    if (!buffer || buffer.length === 0) {
      const error = new Error('EMPTY_AUDIO');
      error.code = 'EMPTY_AUDIO';
      throw error;
    }

    const file = await OpenAI.toFile(buffer, 'audio.ogg');

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe"
    });

    const text = (transcription.text || '').trim();

    if (!text) {
      const error = new Error('EMPTY_TRANSCRIPTION');
      error.code = 'EMPTY_TRANSCRIPTION';
      throw error;
    }

    logger.info(`Audio transcribed successfully (${buffer.length} bytes, ${text.length} chars)`);
    return text;

  } catch (error) {
    logger.error('Error in transcriptionService:', {
      code: error.code,
      status: error.status,
      message: error.message,
      audioBytes: buffer?.length || 0,
    });
    throw error;
  }
}

module.exports = { transcribeAudio };
