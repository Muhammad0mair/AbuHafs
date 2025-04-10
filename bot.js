
const { Client } = require('whatsapp-web.js');
// const qrcode = require('qrcode-terminal');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js');

const SHEET_ID = '1Ja1T3NjTAw3fOiJZMIBKHML6N1BtpvlX62x4YLPSmHU';
const EMAIL_FROM = 'abuhafsperfumes@gmail.com';
const EMAIL_PASS = 'wamy slwy rzzk lqgw';
const EMAIL_TO = 'abuhafsperfumes@gmail.com';

const creds = JSON.parse(fs.readFileSync('./creds.json', 'utf-8'));

const client = new Client({
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
    ],
  },
});
client.initialize();
const sessions = {};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_FROM,
        pass: EMAIL_PASS,
    },
});

async function generateOrderNumber(sheet) {
    try {
        const maxRows = 1000;
        const colIndex = 0; // Column A (zero-based index)
        let rowIndex = 1;   // Start from second row

        await sheet.loadCells(`A2:A${maxRows}`); // Load range

        while (rowIndex < maxRows) {
            const cell = sheet.getCell(rowIndex, colIndex);
            if (!cell.value) {
                const today = new Date();
                const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
                const orderNumber = `ORD-${dateStr}-${String(rowIndex).padStart(3, '0')}`;

                await sheet.saveUpdatedCells();
                return orderNumber;
            }
            rowIndex++;
        }

        throw new Error('Sheet is full or no empty row found for new order number.');
    } catch (error) {
        console.error('❌ Error generating order number:', error.message);
        throw error;
    }
}

function generateInvoice(orderNumber, name, address, orderDetails) {
    try {
        const doc = new PDFDocument();
        const dir = './invoices';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const filePath = `${dir}/${orderNumber}.pdf`;
        doc.pipe(fs.createWriteStream(filePath));
        doc.fontSize(25).text(`Invoice: ${orderNumber}`, { align: 'center' });
        doc.moveDown().fontSize(16).text(`Customer: ${name}`);
        doc.text(`Address: ${address}`);
        doc.text(`Order: ${orderDetails}`);
        doc.moveDown().fontSize(12).text(`Date: ${new Date().toLocaleString()}`);
        doc.end();
        return filePath;
    } catch (error) {
        console.error('❌ Error generating invoice:', error.message);
        throw error;
    }
}

const qrcode = require('qrcode');
let qrGenerated = false; // Flag to control QR generation

// When the QR code is generated
client.on('qr', async (qr) => {
    if (qrGenerated) return; // Skip if already generated


  try {
    // Generate the QR code as a Base64 string
    const base64QR = await qrcode.toDataURL(qr); // This generates a Base64 string
    
    console.log('QR Code as Base64:', base64QR);
    qrGenerated = true; // Mark as generated

    // Optionally, you can send this Base64 string as a message to WhatsApp or any other use case
    // For example, sending it as an image in WhatsApp:
    // await client.sendMessage(msg.from, { 
    //   body: 'Here is your QR Code: ', 
    //   media: { url: base64QR, filename: 'qr-code.png' }
    // });
  } catch (err) {
    console.error('Error generating QR code:', err);
  }
});

client.on('ready', () => console.log('✅ WhatsApp bot is ready!'));

function detectUrdu(text) {
    return /[؀-ۿ]/.test(text);
}

async function calculateTotal(orderDetails) {
    // Remove "order:" prefix if present
    orderDetails = orderDetails.replace(/^order:/i, '').trim();

    // Fetch pricing data from Google Sheets
    const products = await getProductsFromSheet();

    let total = 0;
    const orders = orderDetails.split(',').map(item => item.trim());

    orders.forEach(item => {
        // Match format like "2-50 Office for men"
        const match = item.match(/^(\d+)-(\d+)\s+(.+)$/);
        if (match) {
            const quantity = parseInt(match[1]);
            const size = parseInt(match[2]);
            const productName = match[3].trim().toLowerCase();

            const product = products.find(p =>
                p.name.toLowerCase() === productName &&
                parseInt(p.size) === size
            );

            if (product) {
                total += product.price * quantity;
            }
        }
    });

    return total;
}

async function getProductsFromSheet() {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[1]; // Assume second sheet has product data
    const rows = await sheet.getRows();

    return rows.map(row => ({
        name: row['Product Name'],
        price: parseFloat(row['Price'],),
        size: parseFloat(row['Size (ml)'],)
    }));
}

async function getOrderStatus(orderNumber) {
    // Fetch order status from Google Sheets or database
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0]; // Assuming order status is stored in a separate sheet
    const rows = await sheet.getRows();

    const order = rows.find(row => row['Order Number'].toLowerCase() === orderNumber);
    return order ? order['Status'] : 'Order not found';
}


client.on('message', async msg => {

     // Check if the message is from a group
     if (msg.from.includes('@g.us')) {
        // Don't reply if it's a group message
        return;
    }
    
    try {
        const message = msg.body.trim().toLowerCase();
        const from = msg.from;
        const user = sessions[from] || {};

        // Handle keywords like 'menu', 'rate list', 'products'
        const menuKeywords = ['menu', 'rate list', 'products', 'product list', 'items'];
        if (menuKeywords.some(keyword => message.includes(keyword))) {
            try {
                // Fetch menu from Google Sheets
                const doc = new GoogleSpreadsheet(SHEET_ID);
                await doc.useServiceAccountAuth(creds);
                await doc.loadInfo();
                const sheet = doc.sheetsByIndex[1];
                const rows = await sheet.getRows();
                
                // Prepare the response with the product list
                let menuResponse = 'Here are the available products:\n\n';
                rows.forEach(row => {
                    menuResponse += `Name: ${row['Product Name']}
                    Description: ${row['Description']}
                    Size: ${row['Size (ml)']} ml
                    Price: ${row['Price']}\n `;
                });

                const reply = detectUrdu(message)
                    ? 'یہ ہیں دستیاب مصنوعات:' + menuResponse
                    : menuResponse;

                    return await client.sendMessage(msg.from, reply);
            } catch (error) {
                console.error('❌ Error fetching menu:', error.message);
                msg.reply('There was an error fetching the menu. Please try again later.');
            }
            return; // Exit the function after sending the menu
        }

        if (message.toLowerCase().startsWith('track:')) {
            const orderNumber = message.slice(6).trim();
            const status = await getOrderStatus(orderNumber);
        
            const reply = detectUrdu(message)
                ? `آپ کا آرڈر ${orderNumber} کی حیثیت ہے: ${status}`
                : `The status of your order ${orderNumber} is: ${status}`;
        
                return await client.sendMessage(msg.from, reply);
        }        

        // Handle other order logic (if no menu-related keywords)
        if (message.toLowerCase().startsWith('order:')) {
            user.order = message;
            user.name = null;
            user.address = null;
            sessions[from] = user;

            const reply = detectUrdu(message)
            ? 'براہ کرم اپنا نام بھیجیں۔\n\nمثال: Name: آپ کا نام'
            : 'Please send your name.\n\ne.g: Name: Your Name';
            return await client.sendMessage(msg.from, reply);
        }

        if (!user.name && message.toLowerCase().startsWith('name:')) {
            user.name = message.slice(5).trim();
            const reply = detectUrdu(message)
            ? 'اب اپنا پتہ بھیجیں۔\n\nمثال: Address: آپ کا مکمل پتہ'
            : 'Now please send your address.\n\ne.g Address: Your complete address';
            return await client.sendMessage(msg.from, reply);
        }

        if (user.name && !user.address && message.toLowerCase().startsWith('address:')) {
            user.address = message.slice(8).trim();

            try {
                const doc = new GoogleSpreadsheet(SHEET_ID);
                await doc.useServiceAccountAuth(creds);
                await doc.loadInfo();
                const sheet = doc.sheetsByIndex[0];

                // Calculate total from Google Sheets
                const total = await calculateTotal(user.order);

                const orderNumber = await generateOrderNumber(sheet);
                user.orderNumber = orderNumber;

                await sheet.addRow({
                    'Order Number': orderNumber,
                    'Timestamp': new Date().toISOString(),
                    'Phone': from,
                    'Customer Name': user.name,
                    'Address': user.address,
                    'Order Message': user.order,
                    'Status': 'Pending',
                    'Total Amount': total
                });

                const invoicePath = generateInvoice(orderNumber, user.name, user.address, user.order);

                const mailOptions = {
                    from: `"Order Bot" <${EMAIL_FROM}>`,
                    to: EMAIL_TO,
                    subject: `New Order ${orderNumber}`,
                    html: `
                        <h3>New Order Received</h3>
                        <p><strong>Order Number:</strong> ${orderNumber}</p>
                        <p><strong>Customer:</strong> ${user.name}</p>
                        <p><strong>Phone:</strong> ${from}</p>
                        <p><strong>Address:</strong> ${user.address}</p>
                        <p><strong>Order:</strong> ${user.order}</p>
                        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                    `,
                    attachments: [
                        {
                            filename: `${orderNumber}.pdf`,
                            path: invoicePath
                        }
                    ]
                };

                await transporter.sendMail(mailOptions);

                // const reply = detectUrdu(message)
                //     ? `آپ کا آرڈر مکمل ہو گیا ہے۔ آپ کا آرڈر نمبر ہے: ${orderNumber}`
                //     : `Your order has been placed successfully. Your order number is: ${orderNumber}`;
                // msg.reply(reply);
                const reply = detectUrdu(message)
                ? `آپ کا آرڈر ${orderNumber} کامیابی سے حاصل ہو گیا ہے۔ آپ کا کل بل ${total}.`
                : `Your order ${orderNumber} has been successfully placed. The total bill is ${total}.`;
                return await client.sendMessage(msg.from, reply);

            } catch (error) {
                console.error('❌ Error processing order:', error.message);
                msg.reply('There was an error processing your order. Please try again later.');
            } finally {
                delete sessions[from];
            }
        }
        // If no command matched and conversation is ongoing
        if (!message.toLowerCase().startsWith('order:') &&
        !message.toLowerCase().startsWith('name:') &&
        !message.toLowerCase().startsWith('address:')) {

            const greetings = ['hello','aoa', 'hi', 'salam', 'assalamualaikum', 'assalam o alaikum', 'asalamualaikum', 'السلام علیکم'];
            const isGreeting = greetings.some(greet => message.toLowerCase().includes(greet));
        
            if (isGreeting || detectUrdu(message)) {
                const reply = detectUrdu(message)
                ? `وعلیکم السلام! خوش آمدید 🌟\n\nبراہ کرم ایک آپشن منتخب کریں:\n1. ہماری پراڈکٹس کی ریٹ لسٹ دیکھنے کے لیے\n2. آرڈر دینے کے لیے\n3. مدد یا رہنمائی کے لیے`
                : `Wa Alaikum Assalam! Welcome 🌟\n\nPlease choose an option:\n1. To view our product rate list\n2. To place an order\n3. For help or guidance`;
                return await client.sendMessage(msg.from, reply);
            }
        
            if (message === '2') {
                const reply = detectUrdu(message)
                    ? `آرڈر دینے کے لیے درج ذیل فارمیٹ استعمال کریں:\n\n*Order:* 1(مقدار)-50(سائز(ML)) Office for men, 2(مقدار)-30(سائز(ML)) Creed Aventus\n\nمثال: (Order: 1-50 Office for men, 2-30 Creed Aventus)`
                    : `To place an order, please follow this format:\n\n*Order:* 1(Quantity)-50(Size(ML)) Office for men, 2(Quantity)-30(Size(ML)) Creed Aventus\n\nE.g: (Order: 1-50 Office for men, 2-30 Creed Aventus)`;
                    return await client.sendMessage(msg.from, reply);
            }else if (message === '3') {
                //  // Notify you (admin) for help request
                // const adminMessage = detectUrdu(message)
                // ? `💬 New Help Request from ${msg.from} (User: ${message})`
                // : `💬 New Help Request from ${msg.from} (User: ${message})`;

                // // Send notification to you (admin)
                // await transporter.sendMail({
                //     from: `"Order Bot" <${EMAIL_FROM}>`,
                //     to: EMAIL_TO,
                //     subject: `New Help Request from ${msg.from}`,
                //     text: adminMessage,
                // });

                // No automatic reply to the user. You handle this yourself.
                //return;

                    const reply = detectUrdu(message)
                    ? `ہمارا نمائندہ جلد آپ سے رابطہ کرے گا!`
                    : `Our representative will contact you soon!`;

                    // Reply to the user
                    return await client.sendMessage(msg.from, reply);

            }else if (message === '1') {
                try {
                    // Fetch menu from Google Sheets
                    const doc = new GoogleSpreadsheet(SHEET_ID);
                    await doc.useServiceAccountAuth(creds);
                    await doc.loadInfo();
                    const sheet = doc.sheetsByIndex[1];
                    const rows = await sheet.getRows();
                    
                    // Prepare the response with the product list
                    // let menuResponse = 'Here are the available products:\n';
                    // rows.forEach(row => {
                    //     menuResponse += `\nName: ${row['Product Name']}\nDescription: ${row['Description']}\nSize: ${row['Size (ml)']} ml\nPrice: ${row['Price']}\n`;
                    // });
    
                    // const reply = detectUrdu(message)
                    //     ? 'یہ ہیں دستیاب مصنوعات:' + menuResponse
                    //     : menuResponse;
    
                    //     return await client.sendMessage(msg.from, reply);


                    let menuResponse = detectUrdu(message)
                        ? 'یہ ہیں دستیاب مصنوعات:\n'
                        : 'Here are the available products:\n';

                    for (const row of rows) {
                        // const name = row['Product Name'];
                        // const description = row['Description'];
                        // const size = row['Size (ml)'];
                        // const price = row['Price'];
                        const imageUrl = row['ImageURL']; // You MUST have this column

                        // const caption = detectUrdu(message)
                        //     ? `نام: ${name}\nتفصیل: ${description}\nسائز: ${size} ملی لیٹر\nقیمت: ${price}`
                        //     : `Name: ${name}\nDescription: ${description}\nSize: ${size} ml\nPrice: ${price}`;


                            const { MessageMedia } = require('whatsapp-web.js');

                            try {
                                const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                                await client.sendMessage(msg.from, media);
                            } catch (err) {
                                console.error(`⚠️ Could not load image for:`, err.message);
                                await client.sendMessage(msg.from); // fallback to text if image fails
                            }


                        // try {
                        //     const media = await MessageMedia.fromUrl(imageUrl);
                        //     await client.sendMessage(msg.from, media, { caption });
                        // } catch (err) {
                        //     console.error(`⚠️ Could not load image for ${name}:`, err.message);
                        //     await client.sendMessage(msg.from, caption); // fallback to text
                        // }
                    }
                    const fallbackReply = detectUrdu(message)
                    ? `اگر آپ آرڈر دینا چاہتے ہیں تو براہ کرم 2 ٹائپ کریں اور بھیجیں۔`
                    : `If you'd like to place an order, please type and send 2.`;
                
                return await client.sendMessage(msg.from, fallbackReply);
                    
                } catch (error) {
                    console.error('❌ Error fetching menu:', error.message);
                    msg.reply('There was an error fetching the menu. Please try again later.');
                }
                return; 
            }else{
                const fallbackReply = detectUrdu(message)
                ? `براہ کرم ایک آپشن منتخب کریں:\n1. ہماری پراڈکٹس کی ریٹ لسٹ دیکھنے کے لیے\n2. آرڈر دینے کے لیے\n3. مدد یا رہنمائی کے لیے`
                : `Please choose an option:\n1. To view our product rate list\n2. To place an order\n3. For help or guidance`;
                return await client.sendMessage(msg.from, fallbackReply);
            }
            }
        
            
    } catch (error) {
        console.error('❌ Error handling message:', error.message);
    }
});
