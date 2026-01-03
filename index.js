require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Database } = require('./db');

const bot = new TelegramBot(process.env.BOT_TOKEN, { 
  polling: true,
  filepath: false
});

// Konfiguratsiya
const CONFIG = {
  categories: [
    "🍔 Ovqat",
    "🚕 Transport",
    "👕 Kiyim",
    "📱 Texnika",
    "🚗 Mashina",
    "🏠 Uy-ro'zg'or",
    "💊 Sog'liq",
    "📦 Boshqa"
  ],
  
  categoryExamples: {
    "🍔 Ovqat": "burger, palov, pepsi, nonushta",
    "🚕 Transport": "taksi, metro, yo'l haqi, avtobus",
    "👕 Kiyim": "fudbolka, shim, krasovka, palto",
    "📱 Texnika": "telefon, zaryadnik, planshet, naushnik",
    "🚗 Mashina": "benzin, tuzatish, yuvish, to'lov",
    "🏠 Uy-ro'zg'or": "chiroq, gilam, oshxona buyumlari",
    "💊 Sog'liq": "dori, vitamin, shifokor, analiz",
    "📦 Boshqa": "sovg'a, xayriya, o'yinchoq, kitob"
  },
  
  limits: {
    maxAmount: 1000000000,
    descriptionMaxLength: 200,
    expensesPerPage: 5,
    reportPerPage: 5
  }
};

// Foydalanuvchi holati
const userState = {};

// Klaviaturalar
const Keyboards = {
  main: {
    keyboard: [
      ["➕ Harajat qo'shish", "🗑 Oxirgi harajatni o'chirish"],
      ["📊 Haftalik hisobot", "📈 Oylik hisobot"],
      ["📅 Bugungi hisobot", "⚙️ Sozlamalar"],
      ["ℹ️ Yordam", "📋 Barcha harajatlar"]
    ],
    resize_keyboard: true
  },
  
  category: {
    keyboard: CONFIG.categories.map(c => [c]),
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

// Yordamchi funksiyalar
const Utils = {
  parseAmount: (text) => {
    if (!text || typeof text !== 'string') return { valid: false, error: "Summa kiritilmagan" };
    
    let cleanText = text.replace(/\s/g, '');
    cleanText = cleanText.replace(',', '.');
    cleanText = cleanText.replace(/[^\d.]/g, '');
    
    const dotCount = (cleanText.match(/\./g) || []).length;
    if (dotCount > 1) {
      const lastDotIndex = cleanText.lastIndexOf('.');
      cleanText = cleanText.substring(0, lastDotIndex).replace(/\./g, '') + cleanText.substring(lastDotIndex);
    }
    
    if (!cleanText || cleanText === '.') {
      return { valid: false, error: "Summa noto'g'ri formatda" };
    }
    
    const amount = parseFloat(cleanText);
    
    if (isNaN(amount)) {
      return { valid: false, error: "Summa raqam bo'lishi kerak" };
    }
    
    if (amount <= 0) {
      return { valid: false, error: "Summa 0 dan katta bo'lishi kerak" };
    }
    
    if (amount > CONFIG.limits.maxAmount) {
      return { valid: false, error: `Summa ${CONFIG.limits.maxAmount.toLocaleString('uz-UZ')} so'mdan oshmasligi kerak` };
    }
    
    const roundedAmount = Math.round(amount * 100) / 100;
    
    return {
      valid: true,
      amount: roundedAmount,
      formatted: roundedAmount.toLocaleString('uz-UZ', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })
    };
  },
  
  formatDate: (dateString) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  },
  
  formatAmount: (amount) => {
    return amount.toLocaleString('uz-UZ', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }
};

// Bot funksiyalari
const BotFunctions = {
  handleAddExpense: async (chatId, text) => {
    if (!userState[chatId] || !userState[chatId].step) {
      userState[chatId] = { step: 'category' };
      await bot.sendMessage(chatId, "Kategoriya tanlang:", {
        reply_markup: Keyboards.category
      });
      return;
    }
    
    const state = userState[chatId];
    
    switch (state.step) {
      case 'category':
        if (CONFIG.categories.includes(text)) {
          state.category = text;
          state.step = 'description';
          
          const example = CONFIG.categoryExamples[text] || "tavsif yozing";
          await bot.sendMessage(
            chatId,
            `Qisqacha tavsif yozing:\nMisol: ${example}`,
            {
              reply_markup: { remove_keyboard: true }
            }
          );
        } else {
          await bot.sendMessage(chatId, "❌ Iltimos, kategoriyalardan birini tanlang:", {
            reply_markup: Keyboards.category
          });
        }
        break;
        
      case 'description':
        if (text.length > CONFIG.limits.descriptionMaxLength) {
          await bot.sendMessage(
            chatId,
            `❌ Tavsif juda uzun. Maksimum ${CONFIG.limits.descriptionMaxLength} belgi bo'lishi mumkin.\nIltimos, qisqaroq tavsif yozing:`
          );
          return;
        }
        
        state.description = text;
        state.step = 'amount';
        
        await bot.sendMessage(
          chatId,
          "Summani kiriting:\nMisol: 15000"
        );
        break;
        
      case 'amount':
        const amountResult = Utils.parseAmount(text);
        
        if (!amountResult.valid) {
          await bot.sendMessage(chatId, `❌ ${amountResult.error}\nIltimos, qaytadan kiriting:`);
          return;
        }
        
        const { category, description } = state;
        const date = new Date().toISOString().split('T')[0];
        
        try {
          await Database.addExpense(
            chatId,
            category,
            description,
            amountResult.amount,
            date
          );
          
          const message = 
            `✅ Harajat saqlandi!\n\n` +
            `🏷 Kategoriya: ${category}\n` +
            `📝 Tavsif: ${description}\n` +
            `💰 Summa: ${amountResult.formatted} so'm\n` +
            `📅 Sana: ${date}`;
          
          await bot.sendMessage(chatId, message, {
            reply_markup: Keyboards.main
          });
          
          delete userState[chatId];
        } catch (error) {
          console.error('Saqlash xatosi:', error);
          await bot.sendMessage(
            chatId,
            "❌ Saqlashda xato chiqdi. Iltimos, qayta urinib ko'ring.",
            { reply_markup: Keyboards.main }
          );
        }
        break;
    }
  },
  
  handleDeleteLastExpense: async (chatId) => {
    try {
      const row = await Database.getLastExpense(chatId);
      
      if (!row) {
        await bot.sendMessage(
          chatId,
          "❌ O'chirish uchun harajat topilmadi",
          { reply_markup: Keyboards.main }
        );
        return;
      }
      
      const expenseId = row._id || row.id;
      
      const deleteKeyboard = {
        inline_keyboard: [[
          { 
            text: "✅ Ha, o'chirish", 
            callback_data: `delete:${expenseId}:${chatId}` 
          },
          { 
            text: "❌ Bekor qilish", 
            callback_data: `cancel_delete:${chatId}` 
          }
        ]]
      };
      
      const message = 
        `🗑 Oxirgi harajatni o'chirish\n\n` +
        `📅 Sana: ${Utils.formatDate(row.date)}\n` +
        `🏷 Kategoriya: ${row.category}\n` +
        `📝 Tavsif: ${row.description}\n` +
        `💰 Summa: ${Utils.formatAmount(row.amount)} so'm\n\n` +
        `Rostan ham o'chirmoqchimisiz?`;
      
      await bot.sendMessage(chatId, message, {
        reply_markup: deleteKeyboard
      });
    } catch (error) {
      console.error('Oxirgi harajatni olish xatosi:', error);
      await bot.sendMessage(
        chatId,
        "❌ Ma'lumotlar bazasida xato",
        { reply_markup: Keyboards.main }
      );
    }
  },
  
  showAllExpenses: async (chatId, page = 0) => {
    try {
      const totalCount = await Database.getExpensesCount(chatId);
      
      if (!totalCount || totalCount === 0) {
        await bot.sendMessage(
          chatId,
          "📋 Barcha harajatlar\n\n❗ Hali hech qanday harajat kiritilmagan.",
          {
            reply_markup: Keyboards.main
          }
        );
        return;
      }
      
      const totalPages = Math.ceil(totalCount / CONFIG.limits.expensesPerPage);
      const offset = page * CONFIG.limits.expensesPerPage;
      
      const rows = await Database.getPaginatedExpenses(
        chatId,
        CONFIG.limits.expensesPerPage,
        offset
      );
      
      if (!rows || rows.length === 0) {
        await bot.sendMessage(
          chatId,
          "❌ Ma'lumotlarni olishda xato",
          { reply_markup: Keyboards.main }
        );
        return;
      }
      
      let message = `📋 Barcha harajatlar\n\n`;
      message += `📊 Jami: ${totalCount} ta harajat\n`;
      message += `📄 Sahifa: ${page + 1}/${totalPages}\n\n`;
      
      rows.forEach((row, index) => {
        const globalIndex = offset + index + 1;
        message += `${globalIndex}. ${Utils.formatDate(row.date)}\n`;
        message += `   ${row.category}\n`;
        message += `   ${row.description}\n`;
        message += `   💰 ${Utils.formatAmount(row.amount)} so'm\n\n`;
      });
      
      const keyboard = [];
      
      if (page > 0) {
        keyboard.push({
          text: "⬅️ Oldingi",
          callback_data: `all:${page - 1}:${chatId}`
        });
      }
      
      if (page < totalPages - 1) {
        keyboard.push({
          text: "Keyingi ➡️",
          callback_data: `all:${page + 1}:${chatId}`
        });
      }
      
      const replyMarkup = keyboard.length > 0 ? {
        inline_keyboard: [keyboard]
      } : null;
      
      await bot.sendMessage(chatId, message, {
        reply_markup: replyMarkup || Keyboards.main
      });
    } catch (error) {
      console.error('Barcha harajatlar xatosi:', error);
      await bot.sendMessage(
        chatId,
        "❌ Ma'lumotlarni olishda xato",
        { reply_markup: Keyboards.main }
      );
    }
  },
  
  showPeriodReport: async (chatId, startDate, title, page = 0, endDate = null) => {
    try {
      const rows = await Database.getPeriodReport(chatId, startDate, endDate);
      
      if (!rows || rows.length === 0) {
        await bot.sendMessage(
          chatId,
          `${title}\n\n❗ Bu davrda harajat yo'q.`,
          {
            reply_markup: Keyboards.main
          }
        );
        return;
      }
      
      // Kategoriyalar bo'yicha statistika
      const categoryTotals = {};
      let grandTotal = 0;
      
      rows.forEach(row => {
        categoryTotals[row.category] = (categoryTotals[row.category] || 0) + row.amount;
        grandTotal += row.amount;
      });
      
      // Kategoriyalarni saralash
      const sortedCategories = Object.entries(categoryTotals)
        .sort((a, b) => b[1] - a[1]);
      
      let message = `${title}\n\n`;
      
      // Umumiy statistika
      message += `📊 Statistika:\n`;
      message += `💰 Jami: ${Utils.formatAmount(grandTotal)} so'm\n`;
      message += `📝 Harajatlar soni: ${rows.length} ta\n`;
      
      if (sortedCategories.length > 0) {
        message += `🥇 Eng ko'p: ${sortedCategories[0][0]} (${Utils.formatAmount(sortedCategories[0][1])} so'm)\n`;
        
        if (sortedCategories.length > 1) {
          message += `🥈 Ikkinchi: ${sortedCategories[1][0]} (${Utils.formatAmount(sortedCategories[1][1])} so'm)\n`;
        }
      }
      
      message += `\n📋 Kategoriyalar bo'yicha:\n`;
      
      // Kategoriyalar bo'yicha taqsimot
      sortedCategories.forEach(([category, total], index) => {
        const percentage = ((total / grandTotal) * 100).toFixed(1);
        message += `${index + 1}. ${category} — ${Utils.formatAmount(total)} so'm (${percentage}%)\n`;
      });
      
      // Sahifali harajatlar
      const totalPages = Math.ceil(rows.length / CONFIG.limits.reportPerPage);
      const startIndex = page * CONFIG.limits.reportPerPage;
      const endIndex = Math.min(startIndex + CONFIG.limits.reportPerPage, rows.length);
      const pageRows = rows.slice(startIndex, endIndex);
      
      message += `\n📅 So'nggi harajatlar (${page + 1}/${totalPages}):\n`;
      
      pageRows.forEach((row, index) => {
        const globalIndex = startIndex + index + 1;
        message += `\n${globalIndex}. ${Utils.formatDate(row.date)}\n`;
        message += `   ${row.category}\n`;
        message += `   ${row.description}\n`;
        message += `   💰 ${Utils.formatAmount(row.amount)} so'm\n`;
      });
      
      // Pagination tugmalari
      const keyboard = [];
      
      if (page > 0) {
        keyboard.push({
          text: "⬅️ Oldingi",
          callback_data: `report:${page - 1}:${chatId}:${startDate}:${title.replace(/ /g, '_')}${endDate ? `:${endDate}` : ''}`
        });
      }
      
      if (page < totalPages - 1) {
        keyboard.push({
          text: "Keyingi ➡️",
          callback_data: `report:${page + 1}:${chatId}:${startDate}:${title.replace(/ /g, '_')}${endDate ? `:${endDate}` : ''}`
        });
      }
      
      const replyMarkup = keyboard.length > 0 ? {
        inline_keyboard: [keyboard]
      } : Keyboards.main;
      
      await bot.sendMessage(chatId, message, {
        reply_markup: replyMarkup
      });
    } catch (error) {
      console.error('Hisobot xatosi:', error);
      await bot.sendMessage(
        chatId,
        "❌ Hisobotda xato chiqdi",
        { reply_markup: Keyboards.main }
      );
    }
  },
  
  showHelp: async (chatId) => {
    const helpText = 
      "ℹ️ YORDAM\n\n" +
      "Asosiy funktsiyalar:\n" +
      "➕ Harajat qo'shish - yangi harajat kiritish\n" +
      "📊 Haftalik hisobot - oxirgi 7 kunlik hisobot\n" +
      "📈 Oylik hisobot - oxirgi 30 kunlik hisobot\n" +
      "📅 Bugungi hisobot - bugungi harajatlar\n" +
      "🗑 Oxirgi harajatni o'chirish - so'nggi harajatni o'chirish\n" +
      "📋 Barcha harajatlar - barcha kiritilgan harajatlar\n\n" +
      "Qo'shimcha komandalar:\n" +
      "/today - bugungi harajatlar\n" +
      "/monthly [oy] - ma'lum oy uchun hisobot\n" +
      "/delete_last - oxirgi harajatni o'chirish\n\n" +
      "Misol: /monthly 2024-01";
    
    await bot.sendMessage(chatId, helpText, {
      reply_markup: Keyboards.main
    });
  }
};

// Komanda handlerlari
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  userState[chatId] = {};
  
  const welcomeMessage = 
    "👋 Salom! Bu — Harajat hisob bot.\n\n" +
    "Harajatlaringizni kuzatish va boshqarish uchun asosiy menyudan foydalaning.\n\n" +
    "ℹ️ Qanday ishlatish:\n" +
    "1. \"➕ Harajat qo'shish\" ni bosing\n" +
    "2. Kategoriya tanlang\n" +
    "3. Tavsif yozing (masalan: burger, taksi)\n" +
    "4. Summa kiriting (masalan: 25000)\n\n" +
    "📊 Hisobotlar:\n" +
    "• Bugungi harajatlar\n" +
    "• Haftalik hisobot (7 kun)\n" +
    "• Oylik hisobot (30 kun)";
  
  await bot.sendMessage(chatId, welcomeMessage, {
    reply_markup: Keyboards.main
  });
});

bot.onText(/\/help/, async (msg) => {
  await BotFunctions.showHelp(msg.chat.id);
});

bot.onText(/\/today/, async (msg) => {
  const today = new Date().toISOString().split('T')[0];
  await BotFunctions.showPeriodReport(msg.chat.id, today, "📅 Bugungi harajatlar", 0);
});

bot.onText(/\/monthly (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const month = match[1];
  
  if (!/^\d{4}-\d{2}$/.test(month)) {
    await bot.sendMessage(chatId, "❌ Noto'g'ri format. Iltimos: /monthly 2024-01", {
      reply_markup: Keyboards.main
    });
    return;
  }
  
  const startDate = `${month}-01`;
  const endDate = `${month}-31`;
  
  await BotFunctions.showPeriodReport(chatId, startDate, `📅 ${month} oyi hisoboti`, 0, endDate);
});

bot.onText(/\/delete_last/, async (msg) => {
  await BotFunctions.handleDeleteLastExpense(msg.chat.id);
});

bot.onText(/\/all_expenses/, async (msg) => {
  await BotFunctions.showAllExpenses(msg.chat.id, 0);
});

// Xabarlar handleri
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text) return;
  
  if (text.startsWith('/')) {
    return;
  }
  
  // Foydalanuvchi holatini tekshirish (harajat qo'shish jarayoni)
  if (userState[chatId] && userState[chatId].step) {
    await BotFunctions.handleAddExpense(chatId, text);
    return;
  }
  
  // Asosiy menyu tugmalari
  switch (text) {
    case "➕ Harajat qo'shish":
      userState[chatId] = { step: 'category' };
      await bot.sendMessage(chatId, "Kategoriya tanlang:", {
        reply_markup: Keyboards.category
      });
      break;
      
    case "🗑 Oxirgi harajatni o'chirish":
    case "✏️ Oxirgi harajatni o'chirish":
      await BotFunctions.handleDeleteLastExpense(chatId);
      break;
      
    case "📊 Haftalik hisobot":
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];
      await BotFunctions.showPeriodReport(chatId, weekAgo, "📊 Haftalik hisobot (7 kun)", 0);
      break;
      
    case "📈 Oylik hisobot":
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];
      await BotFunctions.showPeriodReport(chatId, monthAgo, "📈 Oylik hisobot (30 kun)", 0);
      break;
      
    case "📅 Bugungi hisobot":
      const today = new Date().toISOString().split('T')[0];
      await BotFunctions.showPeriodReport(chatId, today, "📅 Bugungi harajatlar", 0);
      break;
      
    case "📋 Barcha harajatlar":
      await BotFunctions.showAllExpenses(chatId, 0);
      break;
      
    case "⚙️ Sozlamalar":
      const settingsKeyboard = {
        inline_keyboard: [
          [{ text: "🔄 Kategoriya misollarini ko'rish", callback_data: "examples" }],
          [{ text: "📊 Bugungi statistika", callback_data: "stats_today" }],
          [{ text: "⬅️ Asosiy menyu", callback_data: "main_menu" }]
        ]
      };
      
      await bot.sendMessage(chatId, "⚙️ Sozlamalar:\n\nQuyidagi variantlardan birini tanlang:", {
        reply_markup: settingsKeyboard
      });
      break;
      
    case "ℹ️ Yordam":
      await BotFunctions.showHelp(chatId);
      break;
      
    default:
      await bot.sendMessage(chatId, "❌ Noma'lum buyruq. Yordam uchun /help ni yuboring.", {
        reply_markup: Keyboards.main
      });
  }
});

// Callback query handleri
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  
  await bot.answerCallbackQuery(query.id).catch(() => {});
  
  if (data === 'examples') {
    let examplesText = "🔄 Kategoriya misollari:\n\n";
    for (const [category, example] of Object.entries(CONFIG.categoryExamples)) {
      examplesText += `${category}:\n${example}\n\n`;
    }
    
    await bot.sendMessage(chatId, examplesText, {
      reply_markup: Keyboards.main
    });
    return;
  }
  
  if (data === 'stats_today') {
    const today = new Date().toISOString().split('T')[0];
    await BotFunctions.showPeriodReport(chatId, today, "📅 Bugungi harajatlar", 0);
    return;
  }
  
  if (data === 'main_menu') {
    await bot.sendMessage(chatId, "Asosiy menyu:", {
      reply_markup: Keyboards.main
    });
    return;
  }
  
  const parts = data.split(':');
  const action = parts[0];
  
  switch (action) {
    case 'delete':
      const id = parts[1];
      const targetChatId = parseInt(parts[2]);
      
      if (targetChatId !== chatId) {
        return;
      }
      
      try {
        const deletedCount = await Database.deleteExpense(id, chatId);
        
        if (deletedCount > 0) {
          await bot.editMessageText("✅ Harajat muvaffaqiyatli o'chirildi!", {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
          });
          
          setTimeout(async () => {
            await bot.sendMessage(chatId, "Harajat o'chirildi. Yangi amalni tanlang:", {
              reply_markup: Keyboards.main
            });
          }, 500);
        } else {
          await bot.editMessageText("❌ Harajat topilmadi", {
            chat_id: chatId,
            message_id: messageId
          });
        }
      } catch (error) {
        console.error('Harajat o\'chirish xatosi:', error);
        await bot.editMessageText("❌ O'chirishda xato", {
          chat_id: chatId,
          message_id: messageId
        });
      }
      break;
      
    case 'cancel_delete':
      const cancelChatId = parseInt(parts[1]);
      
      if (cancelChatId !== chatId) {
        return;
      }
      
      await bot.deleteMessage(chatId, messageId).catch(() => {});
      
      await bot.sendMessage(chatId, "O'chirish bekor qilindi. Yangi amalni tanlang:", {
        reply_markup: Keyboards.main
      });
      break;
      
    case 'all':
      const page = parseInt(parts[1]);
      const allChatId = parseInt(parts[2]);
      
      if (allChatId === chatId) {
        await BotFunctions.showAllExpenses(chatId, page);
      }
      break;
      
    case 'report':
      const reportPage = parseInt(parts[1]);
      const reportChatId = parseInt(parts[2]);
      const startDate = parts[3];
      const title = parts[4].replace(/_/g, ' ');
      const endDate = parts[5];
      
      if (reportChatId === chatId) {
        await BotFunctions.showPeriodReport(chatId, startDate, title, reportPage, endDate);
      }
      break;
  }
});

// Xato handlerlari
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

bot.on('polling_error', (error) => {
  console.error('Polling Error:', error);
});

// Botni ishga tushirish
console.log("🚀 Bot to'liq ishga tushdi...");
console.log("📊 Asosiy funksiyalar:");
console.log("   • Harajat qo'shish");
console.log("   • Hisobotlar (kunlik, haftalik, oylik) - pagination bilan");
console.log("   • Oxirgi harajatni o'chirish");
console.log("   • Barcha harajatlar - pagination bilan");