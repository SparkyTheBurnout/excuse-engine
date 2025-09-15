
import express from 'express';
import Stripe from 'stripe';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const APP_BASE_URL = process.env.APP_BASE_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;

// Get proper base URL for Replit
function getBaseUrl() {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL;
  }
  
  // Check if we're in a deployed environment
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return process.env.REPLIT_DEPLOYMENT_URL;
  }
  
  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    // Force lowercase for consistency
    return `https://${process.env.REPL_SLUG.toLowerCase()}.${process.env.REPL_OWNER.toLowerCase()}.repl.co`;
  }
  
  // Fallback for development
  return `http://0.0.0.0:${PORT}`;
}

const ACTUAL_BASE_URL = getBaseUrl();

// Initialize Stripe
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  console.log('✅ Stripe initialized');
} else {
  console.log('⚠️  STRIPE_SECRET_KEY not found in environment');
}

// Pack ID to price mapping
const PACK_PRICE_MAP = {
  'work': 'PRICE_WORK',
  'date': 'PRICE_DATE', 
  'parent': 'PRICE_PARENT',
  'gamer': 'PRICE_GAMER',
  'holiday': 'PRICE_HOLIDAY',
  'all': 'PRICE_ALL',
  'sub_monthly': 'PRICE_SUB_MONTHLY'
};

// Correct Stripe price IDs from ACTUAL test account (verified via API)
const CORRECT_PRICE_IDS = {
  'PRICE_ALL': 'price_1Rz7iqQzMXVdiYQyeHtnuRh1',      // All Access Bundle $19.99
  'PRICE_HOLIDAY': 'price_1Rz7iCQzMXVdiYQynerEWHbi',   // Holiday Family Alibis $5.00
  'PRICE_SUB_MONTHLY': 'price_1S2OXlQzMXVdiYQyQxX9awtM', // Pro Monthly $1.99
  'PRICE_GAMER': 'price_1Rz7hHQzMXVdiYQyGkmxd3db',     // Gamer Pack $5.00 ✅
  'PRICE_WORK': 'price_1Rz7enQzMXVdiYQytekHcQer',      // Corporate Survival $5.00
  'PRICE_DATE': 'price_1Rz7fyQzMXVdiYQy7vASPyED',      // Dating Disaster $5.00
  'PRICE_PARENT': 'price_1Rz7ghQzMXVdiYQyuSD3ocWG'     // Parent-Teacher $5.00
};

// Reverse mapping: price ID -> pack ID (for fallback when metadata is missing)
const PRICE_ID_TO_PACK_MAP = {};
Object.entries(PACK_PRICE_MAP).forEach(([packId, priceKey]) => {
  const priceId = CORRECT_PRICE_IDS[priceKey];
  if (priceId) {
    PRICE_ID_TO_PACK_MAP[priceId] = packId;
  }
});

// Basic cache for Stripe API calls (5 minute TTL)
const stripeCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedStripeResult(userKey) {
  const cached = stripeCache.get(userKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`📁 Using cached Stripe result for user: ${userKey}`);
    return cached.data;
  }
  return null;
}

function setCachedStripeResult(userKey, data) {
  stripeCache.set(userKey, {
    data: data,
    timestamp: Date.now()
  });
  console.log(`💾 Cached Stripe result for user: ${userKey}`);
}

const VALID_PACK_IDS = Object.keys(PACK_PRICE_MAP);

// Check environment variables on startup
function checkEnvironment() {
  const missing = [];
  
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
  
  Object.values(PACK_PRICE_MAP).forEach(env => {
    if (!process.env[env]) missing.push(env);
  });
  
  if (missing.length > 0) {
    console.log('⚠️  Missing environment variables:');
    missing.forEach(env => console.log(`   - ${env}`));
    console.log('\n📝 Add these in Replit Tools → Secrets');
    console.log('\n🚨 App will not work properly without these secrets!');
  } else {
    console.log('✅ All environment variables configured');
    console.log('✅ Ready for production deployment');
  }
}

checkEnvironment();

// Middleware - CRITICAL: Raw body for webhooks must come first
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));
// Alternative approach - use text parser for webhooks in case raw doesn't work in Replit
app.use('/api/stripe-webhook', express.text({ type: 'application/json' }));
app.use(express.json());

// Dynamic URL detection
app.use((req, res, next) => {
  // Store the actual request host for use in redirects
  res.locals.baseUrl = `https://${req.get('host')}`;
  next();
});

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// User key management
function getUserKey(req, res) {
  let userKey = req.headers['x-user-key'];
  
  if (!userKey) {
    userKey = uuidv4();
    res.setHeader('X-Set-User-Key', userKey);
  }
  
  return userKey;
}

// Entitlements store
function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function loadEntitlements() {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'entitlements.json');
    
    if (!fs.existsSync(filePath)) {
      return {};
    }
    
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error('Error loading entitlements:', error);
    return {};
  }
}

function saveEntitlements(entitlements) {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'entitlements.json');
    
    fs.writeFileSync(filePath, JSON.stringify(entitlements, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving entitlements:', error);
    return false;
  }
}

function grantEntitlement(userKey, packId) {
  const entitlements = loadEntitlements();
  
  if (!entitlements[userKey]) {
    entitlements[userKey] = { packs: [], pro: false, updatedAt: Date.now() };
  }
  
  if (packId === 'all') {
    // Grant all individual packs and pro status
    entitlements[userKey].packs = ['work', 'date', 'parent', 'gamer', 'holiday'];
    entitlements[userKey].pro = true;
  } else if (packId === 'sub_monthly') {
    // Grant pro subscription
    entitlements[userKey].pro = true;
  } else {
    // Grant individual pack
    if (!entitlements[userKey].packs.includes(packId)) {
      entitlements[userKey].packs.push(packId);
    }
  }
  
  entitlements[userKey].updatedAt = Date.now();
  
  const success = saveEntitlements(entitlements);
  console.log(`${success ? '✅' : '❌'} Granted ${packId} to user ${userKey}`);
  
  return success;
}

// Serve static files
app.use(express.static('public'));

// Fallback redirect handler for success page
app.get('/success', (req, res) => {
  res.redirect('/success.html' + (req.query.session_id ? `?cs=${req.query.session_id}` : ''));
});

// Emergency endpoint removed - user's purchase successfully restored

// Debug endpoint removed for production security

// API Routes
app.get('/api/health', (req, res) => {
  const health = {
    ok: true,
    timestamp: Date.now(),
    stripe_configured: !!stripe,
    webhook_secret_configured: !!process.env.STRIPE_WEBHOOK_SECRET,
    base_url: ACTUAL_BASE_URL,
    missing_env_vars: []
  };
  
  // Check for missing environment variables
  Object.values(PACK_PRICE_MAP).forEach(env => {
    if (!process.env[env]) {
      health.missing_env_vars.push(env);
    }
  });
  
  if (health.missing_env_vars.length > 0) {
    health.ok = false;
  }
  
  res.json(health);
});

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(400).json({ error: 'Stripe not configured' });
    }

    const { packId } = req.body;
    
    if (!packId || !VALID_PACK_IDS.includes(packId)) {
      return res.status(400).json({ error: 'Invalid pack ID' });
    }

    const priceKey = PACK_PRICE_MAP[packId];
    const priceId = CORRECT_PRICE_IDS[priceKey] || process.env[priceKey];
    
    if (!priceId) {
      return res.status(400).json({ error: `Price ID not configured for ${packId} (${priceKey})` });
    }

    const userKey = getUserKey(req, res);
    
    const mode = packId === 'sub_monthly' ? 'subscription' : 'payment';
    
    const baseUrl = res.locals.baseUrl || ACTUAL_BASE_URL;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: mode,
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      success_url: `${baseUrl}/success.html?cs={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
      metadata: { 
        userKey: userKey,
        packId: packId
      },
      client_reference_id: userKey,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/api/stripe-webhook', async (req, res) => {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return res.status(400).send('Webhook secret not configured');
    }

    const sig = req.headers['stripe-signature'];
    console.log('🔍 Webhook received, signature present:', !!sig);
    console.log('🔍 Request body type:', typeof req.body);
    console.log('🔍 Request body length:', req.body?.length);

    if (!sig) {
      console.error('❌ No Stripe signature found in headers');
      return res.status(400).send('No signature header found');
    }

    let event;
    let rawBody = req.body;
    
    console.log('🔍 Raw body details:');
    console.log('  - Type:', typeof rawBody);
    console.log('  - Is Buffer:', Buffer.isBuffer(rawBody));
    console.log('  - Is String:', typeof rawBody === 'string');
    console.log('  - Constructor:', rawBody?.constructor?.name);

    // Handle different body formats that might come from Replit proxy
    if (Buffer.isBuffer(rawBody)) {
      // Perfect - we have the raw buffer
      console.log('✅ Using raw Buffer for verification');
    } else if (typeof rawBody === 'string') {
      // Good - we have the raw string 
      console.log('✅ Using raw string for verification');
    } else if (typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)) {
      // Problematic - need to convert but this will likely fail verification
      console.log('⚠️  Converting object to string - may fail verification');
      rawBody = JSON.stringify(rawBody);
    } else {
      console.log('❌ Unknown body format');
      return res.status(400).send('Invalid request body format');
    }

    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
      console.log('✅ Webhook signature verified successfully');
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      console.log('Debug info:');
      console.log('  - Raw body type:', typeof rawBody);
      console.log('  - Signature header:', sig?.substring(0, 50) + '...');
      console.log('  - Body sample:', (typeof rawBody === 'string' ? rawBody : rawBody.toString?.('utf8') || 'Not convertible').substring(0, 200));
      console.log('  - Webhook secret configured:', !!process.env.STRIPE_WEBHOOK_SECRET);
      
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`📨 Webhook event: ${event.type}`);
    console.log(`📨 Event data:`, JSON.stringify(event.data.object, null, 2));

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userKey = session.metadata?.userKey || session.client_reference_id;
      const packId = session.metadata?.packId;

      console.log(`🔑 Processing checkout for user: ${userKey}, pack: ${packId}`);

      if (userKey && packId) {
        const success = grantEntitlement(userKey, packId);
        if (success) {
          console.log(`✅ Entitlement granted: ${packId} to ${userKey}`);
        } else {
          console.error(`❌ Failed to grant entitlement: ${packId} to ${userKey}`);
        }
      } else {
        console.error('❌ Missing userKey or packId in webhook:', { userKey, packId, metadata: session.metadata });
      }
    } else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      
      console.log(`💳 Processing subscription payment for: ${subscriptionId}`);
      
      if (subscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const userKey = subscription.metadata?.userKey || subscription.client_reference_id;
          
          if (userKey) {
            const success = grantEntitlement(userKey, 'sub_monthly');
            console.log(`✅ Subscription granted to: ${userKey}`);
          } else {
            console.error('❌ No userKey in subscription metadata or client_reference_id');
          }
        } catch (error) {
          console.error('❌ Failed to retrieve subscription:', error.message);
        }
      }
    } else {
      console.log(`ℹ️  Unhandled webhook event: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Enhanced restore endpoint with Stripe fallback
app.get('/api/restore', async (req, res) => {
  try {
    const userKey = req.headers['x-user-key'];
    
    console.log(`🔍 Restore request for user: ${userKey}`);
    
    if (!userKey) {
      console.log('❌ No user key provided');
      return res.json({ packs: [], pro: false });
    }
    
    // First, check local entitlements
    const entitlements = loadEntitlements();
    let userEntitlements = entitlements[userKey] || { packs: [], pro: false };
    
    console.log(`📦 Local entitlements:`, userEntitlements);
    
    // If user has no entitlements locally, check Stripe directly
    if (userEntitlements.packs.length === 0 && !userEntitlements.pro) {
      console.log(`🔍 No local entitlements found, checking Stripe for user: ${userKey}`);
      
      // First check cache
      const cachedResult = getCachedStripeResult(userKey);
      if (cachedResult) {
        userEntitlements = cachedResult;
        console.log(`📁 Restored from cache: ${userEntitlements.packs?.length || 0} packs, pro: ${userEntitlements.pro}`);
      } else {
        try {
          // Check Stripe for successful payments by this user
          const recentSessions = await stripe.checkout.sessions.list({
            limit: 100,
            status: 'complete'
          });
          
          // Filter sessions to find ones for this user
          const userSessions = recentSessions.data.filter(session => 
            session.client_reference_id === userKey
          );
          
          console.log(`🔍 Found ${userSessions.length} completed sessions for user`);
          
          const foundPacks = new Set();
          let foundPro = false;
          
          for (const session of userSessions) {
            let packId = session.metadata?.packId;
            console.log(`📦 Session ${session.id}: packId=${packId}, amount=${session.amount_total}`);
            
            // CRITICAL FIX: If no packId in metadata, try to derive from price ID
            if (!packId && session.line_items?.data?.length > 0) {
              const priceId = session.line_items.data[0].price?.id;
              if (priceId && PRICE_ID_TO_PACK_MAP[priceId]) {
                packId = PRICE_ID_TO_PACK_MAP[priceId];
                console.log(`🔄 Derived packId from price ID: ${priceId} → ${packId}`);
              }
            }
            
            // If still no packId, try to get line items and derive from there
            if (!packId) {
              try {
                const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                  expand: ['line_items']
                });
                const priceId = sessionWithLineItems.line_items?.data?.[0]?.price?.id;
                if (priceId && PRICE_ID_TO_PACK_MAP[priceId]) {
                  packId = PRICE_ID_TO_PACK_MAP[priceId];
                  console.log(`🔄 Derived packId from expanded line items: ${priceId} → ${packId}`);
                }
              } catch (expandError) {
                console.error(`⚠️  Failed to expand line items for session ${session.id}:`, expandError.message);
              }
            }
            
            if (packId) {
              if (packId === 'all' || packId === 'all_access') {
                // All access bundle
                foundPacks.add('work');
                foundPacks.add('date'); 
                foundPacks.add('parent');
                foundPacks.add('gamer');
                foundPacks.add('holiday');
                foundPro = true;
                console.log(`✅ Found all access purchase`);
              } else if (packId === 'sub_monthly') {
                // CRITICAL FIX: Handle subscription properly
                foundPro = true;
                console.log(`✅ Found subscription purchase - granted pro status`);
              } else {
                // Individual pack
                foundPacks.add(packId);
                console.log(`✅ Found individual pack: ${packId}`);
              }
            } else {
              console.log(`⚠️  Session ${session.id} has no identifiable pack ID`);
            }
          }
          
          // If we found purchases, grant entitlements
          if (foundPacks.size > 0 || foundPro) {
            userEntitlements = {
              packs: Array.from(foundPacks),
              pro: foundPro,
              updatedAt: Date.now()
            };
            
            // Save to local storage for future requests
            entitlements[userKey] = userEntitlements;
            saveEntitlements(entitlements);
            
            // Cache the result
            setCachedStripeResult(userKey, userEntitlements);
            
            console.log(`✅ Granted entitlements from Stripe: ${foundPacks.size} packs, pro: ${foundPro}`);
          } else {
            console.log(`ℹ️  No completed purchases found in Stripe for user`);
            
            // Cache negative result to prevent repeated API calls
            setCachedStripeResult(userKey, { packs: [], pro: false, updatedAt: Date.now() });
          }
          
        } catch (stripeError) {
          console.error('❌ Failed to query Stripe:', stripeError.message);
          // Continue with local entitlements even if Stripe fails
        }
      }
    }
    
    const response = {
      packs: userEntitlements.packs || [],
      pro: userEntitlements.pro || false
    };
    
    console.log(`✅ Final response:`, response);
    res.json(response);
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Failed to restore entitlements' });
  }
});

// Serve JSON config files
app.get('/packs.json', (req, res) => {
  try {
    const packsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'packs.json'), 'utf8'));
    res.json(packsData);
  } catch (error) {
    console.error('Error serving packs.json:', error);
    res.status(500).json({ error: 'Failed to load packs configuration' });
  }
});

app.get('/ads.json', (req, res) => {
  try {
    const adsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'ads.json'), 'utf8'));
    res.json(adsData);
  } catch (error) {
    console.error('Error serving ads.json:', error);
    res.status(500).json({ error: 'Failed to load ads configuration' });
  }
});

// Creative excuse generator endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { category = 'work', tone = 'apologetic', length = '1 sentence' } = req.body;

    // Creative excuse database organized by category and tone
    const excuseDatabase = {
      work: {
        apologetic: {
          'brief': [
            "Sorry, family emergency.",
            "Apologies, car broke down.",
            "Sorry, feeling sick today.",
            "Apologies, running very late.",
            "Sorry, unexpected issue arose."
          ],
          '1 sentence': [
            "I sincerely apologize for being late due to an unexpected traffic jam.",
            "I'm deeply sorry, but I had a minor family emergency this morning.",
            "I apologize for missing this, my car wouldn't start today.",
            "I'm sorry for the delay, I'm dealing with a sudden illness.",
            "I deeply regret being absent due to a last-minute obligation."
          ],
          '2-3 sentences': [
            "I sincerely apologize for my absence today. My apartment building had a gas leak that required immediate evacuation, and the fire department wouldn't let us back in until this afternoon. I've been sitting in a coffee shop since 6 AM trying to handle everything remotely, but obviously this wasn't ideal for our meeting.",
            "I'm extremely sorry for the delay. My neighbor's dog somehow got into my apartment through our shared balcony and completely destroyed my work setup - knocked over my laptop, chewed through cables, the works. I've spent the morning dealing with this chaos and trying to salvage what I could of my presentation.",
            "I deeply apologize for missing our deadline. My area experienced a power outage that lasted 14 hours, and despite having a backup battery, I discovered my cloud sync had been failing for the past week without any notification. I'm working on recovering everything from my local backup drives now."
          ],
          'paragraph': [
            "I sincerely apologize for my absence today and I understand this may cause significant inconvenience. Early this morning, my apartment building had a major gas leak that required immediate evacuation by the fire department. All residents were forced to leave within minutes, and we weren't allowed back in until late afternoon while they conducted safety inspections. I've been working from a coffee shop since 6 AM, trying to handle everything remotely on my phone, but obviously this wasn't ideal for our important meeting. I take full responsibility for not having a better backup plan in place, and I'm committed to making sure this type of disruption doesn't happen again. I'm available now if you'd like to reschedule, and I'll make sure to prioritize this moving forward.",
            "I'm extremely sorry for the delay and I want to explain what happened. My neighbor's large dog somehow got into my apartment through our shared balcony door, which I apparently didn't lock properly last night. The animal completely destroyed my entire work setup - knocked over my laptop, chewed through multiple cables, scattered papers everywhere, and even damaged my monitor. I've spent the entire morning dealing with this chaos, trying to salvage what I could of my presentation files, and coordinating with my neighbor about the damage. The insurance company needs to assess everything before I can replace my equipment, so I'm currently working from my phone. I understand this sounds unusual, but I have photos if needed. I'm doing everything I can to get back on track as quickly as possible."
          ],
          'detailed': [
            "I want to provide a full explanation for my absence today, as I know how important this meeting was and I take complete responsibility for the disruption this has caused. At approximately 5:30 AM this morning, I was awakened by loud banging on my door and shouting in the hallway. It turned out that my apartment building was experiencing a major gas leak that had been detected by one of the overnight maintenance staff during routine checks. The fire department was called immediately, and within twenty minutes, they had evacuated our entire building - all 47 units. We were told to leave immediately with only essential items, so I grabbed my phone, wallet, and keys, but unfortunately left my laptop and all my work materials behind. The building remained closed for over eight hours while gas company technicians and fire marshals conducted thorough safety inspections of every unit and the entire building's infrastructure. During this time, I tried my best to work from my phone at a nearby coffee shop, but obviously I couldn't access most of my files or complete the presentation we were supposed to review. The fire department finally cleared the building at 2:30 PM, but by then our meeting time had long passed. I've now retrieved all my materials and I'm fully prepared to reschedule at your earliest convenience. I'm also looking into cloud backup solutions to ensure I can access my work from anywhere in case of future emergencies. Again, I sincerely apologize for any inconvenience this has caused, and I'm committed to making sure we can move forward without any further delays."
          ]
        },
        confident: {
          'brief': [
            "Family emergency, need to reschedule.",
            "Urgent matter came up.",
            "Can't make it, sorry.",
            "Have to handle something important.",
            "Need to reschedule immediately."
          ],
          '1 sentence': [
            "I need to reschedule due to a family emergency.",
            "I'm handling an urgent medical situation.",
            "I have an unexpected legal matter to address.",
            "I'm dealing with a home emergency.",
            "I need to handle a school issue."
          ],
          '2-3 sentences': [
            "I need to reschedule our meeting due to a genuine family crisis. My elderly mother fell and potentially broke her hip, and I'm the only family member available to handle her emergency room visit and coordinate with her doctors. This is obviously not something I can delegate or postpone.",
            "I'm going to have to move our appointment. My home office just suffered significant water damage from a burst pipe in the apartment above me, and I need to immediately coordinate with my insurance company and emergency restoration services. My entire work setup is currently underwater, and I need to act fast to prevent permanent damage.",
            "I'll need to postpone this until tomorrow. My teenage daughter was in a minor car accident - she's fine, but the other driver is being difficult about insurance, and I need to be present to handle the police report and insurance claims. As her parent, I'm legally required to be there for this process."
          ],
          'paragraph': [
            "I need to reschedule our meeting due to a family medical emergency. My father-in-law suffered a heart attack this morning and is currently in surgery. As the only family member with medical power of attorney, I need to be at the hospital to make critical decisions and coordinate with the medical team. The surgery is expected to last several hours, and I'll need to stay for recovery monitoring. This obviously takes priority over any work commitments today. I'll have my phone available for urgent matters, but I won't be able to fully focus on business until I know he's stable.",
            "I'm going to have to postpone our appointment due to a serious home emergency. A water pipe burst in my ceiling overnight, causing significant flooding throughout my home office and living areas. Emergency restoration crews are here now, but I need to oversee the damage assessment, coordinate with my insurance company, and ensure all my electronics and important documents are protected. The restoration team estimates this will take most of the day to get under control. I realize this is inconvenient timing, but I need to prevent further structural damage to my home."
          ],
          'detailed': [
            "I need to reschedule our important meeting today due to a significant family emergency that requires my immediate and sustained attention. This morning at around 6 AM, I received a call from the hospital informing me that my father-in-law had suffered a major heart attack and was being rushed into emergency surgery. As his designated medical power of attorney and the only family member currently in town, I have legal responsibility to be present for all medical decisions and to coordinate with the surgical team, cardiologist, and hospital administrators. The surgery is expected to be complex and could last anywhere from 6-10 hours, with additional time needed for initial recovery monitoring. Beyond the immediate medical situation, I also need to coordinate care arrangements for my mother-in-law, who has early-stage dementia and cannot be left alone during this crisis. I've had to arrange for a family friend to stay with her, organize transportation for other family members who are traveling from out of state, and handle various insurance and hospital administrative requirements. While I understand this creates scheduling challenges for our project, I'm confident that addressing this family crisis properly now will allow me to return my full focus to work matters tomorrow. I'll be checking messages periodically throughout the day and am available for any truly urgent matters, but I won't be able to give our meeting the attention and focus it deserves until this situation is stabilized."
          ]
        },
        humorous: {
          'brief': [
            "Epic coffee disaster.",
            "Squirrel traffic jam.",
            "GPS mutiny happened.",
            "Smart home rebellion.",
            "Alarm clock betrayal."
          ],
          '1 sentence': [
            "I'm running late because my coffee maker achieved sentience this morning and we're currently in negotiations about who's really in charge of this household.",
            "I'll be delayed due to an epic battle with my smart home system, which has apparently decided that all my lights should strobe and my thermostat should think we're living in the Arctic.",
            "I'm stuck in what can only be described as a squirrel-related traffic incident where a particularly ambitious rodent has somehow caused a three-car fender bender.",
            "I'm running behind because my GPS took me on what I can only assume was a scenic tour of every dead-end street in a 15-mile radius.",
            "I'll be late due to my neighbor's overly enthusiastic rooster who has apparently decided that 4 AM is the new dawn and has been hosting a crowing concert outside my bedroom window."
          ],
          '2-3 sentences': [
            "I'm going to be fashionably late to our meeting thanks to a comedy of errors that started with my shower running only cold water. This led me to discover that my upstairs neighbor has been accidentally using my hot water heater for what appears to be a small-scale commercial laundry operation. I'm currently mediating this bizarre domestic dispute while wearing a bathrobe and holding a very confused plumber's business card.",
            "I'll need to postpone our call because I'm currently trapped in my own driveway by a delivery truck that's blocking me in while the driver argues with my neighbor about whether our street actually exists according to his GPS. The driver is convinced we're all part of some elaborate hoax, and my neighbor is now showing him property deeds. This is either very funny or very concerning, but either way, I'm not going anywhere soon.",
            "I'm running spectacularly late due to what I'm calling 'The Great Condiment Catastrophe of 2025.' My refrigerator apparently decided to rearrange itself overnight, resulting in a domino effect that ended with every sauce, dressing, and jar exploding across my kitchen floor. I'm currently skating around on a mixture of ranch dressing and pickle juice while questioning all my life choices."
          ],
          'paragraph': [
            "I'm going to need to reschedule our meeting due to what can only be described as the most ridiculous morning of my entire adult life. It started when I woke up to discover that my smart doorbell had somehow synced with my neighbor's Alexa, and now both devices are having what appears to be an existential crisis about whose house is whose. Every time someone approaches either of our front doors, both doorbells announce visitors to the wrong houses, and my Alexa keeps trying to order groceries for my neighbor while theirs keeps turning on my living room lights. I've spent the last two hours on customer service calls with three different tech companies, none of whom believe this is actually possible. Meanwhile, my neighbor and I are standing in our respective driveways trying to figure out how to reclaim control of our own homes. The customer service representative I'm currently on hold with keeps asking me to 'try turning it off and on again,' but I'm afraid if I unplug anything else, my house might achieve full sentience and lock me out permanently.",
            "I need to postpone our appointment because I'm currently living in what I can only describe as a sitcom episode gone wrong. This morning I discovered that my upstairs neighbor's attempt to install a home gym has resulted in their treadmill falling through my ceiling during their morning workout. So I'm now sitting in my living room with a treadmill suspended above my coffee table, still running, with my neighbor's feet visible through the hole they've created. The fire department says this is 'unusual but not technically an emergency' since no one is injured and the treadmill is still structurally supported by the floor joists. However, my neighbor is effectively trapped on their still-running treadmill because they're afraid to step off and potentially fall through into my living room."
          ],
          'detailed': [
            "I'm going to have to reschedule our meeting because I'm currently dealing with what I can only describe as the most absurdly complicated morning disaster in recorded human history. It all started when I woke up at 5 AM to the sound of what I thought was heavy rain, but turned out to be my upstairs neighbor's attempt to create an indoor water feature in their living room. Apparently, they had hired someone from Craigslist to install a 'relaxing fountain,' and this person had somehow connected it to the main water line without properly understanding basic plumbing principles. The result was essentially a geyser in their apartment that was now cascading through my ceiling in what I can only describe as an impromptu indoor waterfall experience. But here's where it gets really interesting: my downstairs neighbor, who is apparently a very heavy sleeper, had left their surround sound system on all night at maximum volume, playing what appears to be a 10-hour loop of whale sounds. The combination of actual falling water and artificial whale songs had created this bizarre sensory experience that I'm pretty sure could be sold as some kind of avant-garde meditation retreat. When the fire department arrived, they stood in my living room for a full five minutes just listening to the whale sounds and watching the water fall before asking if this was some kind of 'intentional art installation.' I had to explain that no, this was just Tuesday morning in my apartment building, but they seemed skeptical until the water pressure finally blew out the upstairs fountain entirely, causing an even more dramatic waterfall effect. The Craigslist installer has apparently disappeared, my upstairs neighbor is mortified and keeps apologizing through the ceiling while trying to contain the flood with beach towels, and my downstairs neighbor finally woke up and is now convinced that the whale sounds somehow summoned an actual marine environment into our building. The water damage restoration team that just arrived says they've seen everything, but this combination of fountain malfunction, surround sound marine life simulation, and confused emergency responders is definitely going in their company newsletter."
          ]
        }
      },
      school: {
        apologetic: {
          'brief': [
            "Sorry, family emergency.",
            "Apologies, car trouble.",
            "Sorry, feeling ill.",
            "Apologies, overslept badly.",
            "Sorry, tech issues."
          ],
          '1 sentence': [
            "I'm sincerely sorry I missed class - I had a severe allergic reaction to something I ate and needed immediate medical attention this morning.",
            "I deeply apologize for my absence, but I had a family emergency involving my grandfather being rushed to the hospital.",
            "I'm sorry for missing the assignment deadline - my laptop crashed and corrupted the file I'd been working on for weeks, despite having what I thought were proper backups.",
            "I apologize for being late to the exam - my car broke down on the highway and I had to wait over an hour for roadside assistance.",
            "I'm truly sorry I couldn't submit my project on time - our internet went out during a storm and stayed down for three days, making online research impossible."
          ],
          '2-3 sentences': [
            "I sincerely apologize for missing today's exam. I woke up this morning with severe food poisoning that required a visit to urgent care, and the doctor advised me not to leave home for at least 24 hours. I have medical documentation and would be grateful for the opportunity to take a makeup exam when I'm feeling better.",
            "I'm extremely sorry for not submitting my research paper on time. My laptop was stolen from my car yesterday while I was at work, along with all my notes and research materials that weren't backed up to the cloud. I've filed a police report and I'm working to recreate as much of the work as possible, but I'll need additional time to complete the assignment properly.",
            "I deeply apologize for my absence from the group presentation today. My younger sister was in a car accident last night and is in the hospital with a broken leg, and I'm the only family member available to handle insurance paperwork and coordinate her care. I realize this puts my group in a difficult position and I take full responsibility for any impact this has on their grades."
          ],
          'paragraph': [
            "I want to sincerely apologize for missing our midterm exam today and explain the circumstances that prevented my attendance. Last night around 11 PM, I received an emergency call that my grandmother had fallen and was being taken to the hospital by ambulance. As her primary emergency contact and the only family member in the area, I spent the entire night at the emergency room while she underwent various tests and X-rays. The doctors discovered she had broken her hip and would need immediate surgery this morning. I stayed with her throughout the night to provide comfort and handle the medical paperwork and insurance authorization forms. By the time the surgery was scheduled for 8 AM, I realized I would not be able to make it to class for our exam. I understand this is a significant inconvenience and I take full responsibility for not having a backup plan in place. I have all the medical documentation from the hospital and would be extremely grateful for the opportunity to take a makeup exam at your convenience. I've been keeping up with all the coursework and feel confident in my preparation for the material.",
            "I am deeply sorry for not turning in my final project today and I want to provide a full explanation of the circumstances. Three days ago, my apartment was broken into while I was at my part-time job. The thieves took my laptop, external hard drive, tablet, and even my backup flash drives - essentially my entire digital life and all my schoolwork for this semester. While I thought I was being responsible by keeping local backups, I discovered that my cloud sync had been failing for weeks without properly notifying me, so most of my recent work wasn't actually saved online. I immediately filed a police report and contacted my insurance company, but recovery is going to take time. I've spent the last three days trying to recreate my project from scratch using library computers and reaching out to classmates for any shared resources we might have exchanged. I realize this puts you in a difficult position with grading timelines, but I'm hoping we can work out an arrangement for a brief extension. I'm committed to producing quality work even under these challenging circumstances, and I have all the documentation from the police report to verify the situation."
          ],
          'detailed': [
            "I want to provide a complete explanation for my absence from today's final presentation and request your understanding regarding the extraordinary circumstances that prevented my attendance. Yesterday afternoon, while I was in the library preparing my final slides, I received a frantic call from my younger brother informing me that our house was on fire. I immediately rushed home to discover that what had started as a small kitchen fire had spread rapidly through our older home, and the fire department was working to contain the blaze. My entire family was safely evacuated, but we watched as the fire destroyed most of our belongings, including my computer, all my printed research materials, backup drives, and the presentation materials I had been working on for the past month. We spent yesterday evening dealing with fire investigators, insurance adjusters, and Red Cross volunteers, and were eventually relocated to a temporary hotel room. This morning I woke up hoping to at least attend class and explain the situation, but discovered that all my identification, wallet, and car keys had been destroyed in the fire. Without proper ID, I couldn't check out a laptop from the library, couldn't access my student account from public computers, and couldn't even get my car out of the impound lot where it had been towed during the emergency response. I'm currently waiting for replacement documents from the DMV and working with the Red Cross to establish temporary housing arrangements. I realize this sounds like an elaborate excuse, but I have extensive documentation from the fire department, insurance company, and Red Cross to verify every detail. I'm not asking for special treatment, just for the opportunity to reschedule my presentation once I have access to basic resources again. Despite losing all my original research, I remember most of my project details and I'm confident I can recreate a quality presentation given a few additional days to rebuild my materials. This experience has actually given me a deeper appreciation for the resilience themes in the literature we've been studying, and I believe I can incorporate these insights into a stronger final presentation than I would have originally delivered."
          ]
        },
        confident: {
          'brief': [
            "Family emergency today.",
            "Medical appointment scheduled.",
            "Court appearance required.",
            "Have prior commitment.",
            "Dealing with urgent matter."
          ],
          '1 sentence': [
            "I won't be able to attend class today due to a pre-scheduled medical appointment that couldn't be moved to accommodate the academic calendar.",
            "I'll need an extension on this assignment as I'm dealing with a documented medical condition that has flared up unexpectedly this week.",
            "I'll be missing today's session to attend my grandfather's funeral, which obviously takes precedence over classroom attendance.",
            "I need to request a makeup exam due to a verified family emergency that required my immediate travel out of state.",
            "I'll be absent today as I'm participating in a court proceeding where my testimony is legally required."
          ],
          '2-3 sentences': [
            "I need to request a makeup exam for today's test. I'm required to appear in court this morning as a witness in a case involving a car accident I witnessed several months ago. The court date was set by the judge and cannot be rescheduled, and my testimony is legally mandated.",
            "I'll be missing class today due to a family medical emergency. My mother is having emergency surgery and I'm needed at the hospital to handle medical decisions and coordinate with her doctors. This obviously takes priority over academic commitments.",
            "I need to reschedule my presentation for next week. I'm dealing with a documented anxiety disorder that has flared up significantly this week due to personal circumstances, and my therapist has advised against high-stress situations until I'm stabilized on new medication."
          ],
          'paragraph': [
            "I need to inform you that I won't be attending class today due to a family emergency that requires my immediate attention out of state. My sister was involved in a serious car accident yesterday evening and is currently in intensive care at a trauma center three states away. As her emergency contact and the only family member available to travel, I'm driving there this morning to handle medical decisions and coordinate with her doctors. The doctors have indicated that her condition is critical and she'll need someone present for at least the next several days to make important healthcare decisions. I've already arranged coverage for my part-time job and have contacted other professors about my situation. I understand this affects my attendance record and any assignments due this week, and I'm prepared to work with you on makeup arrangements once I have a better understanding of my sister's recovery timeline. I have hospital documentation and can provide verification of the emergency if needed.",
            "I'm writing to inform you that I'll need to miss our final exam today due to a legal obligation that cannot be postponed. I've been summoned to serve as a key witness in a criminal trial, and the court appearance is mandatory by law. The case involves a serious crime I witnessed six months ago, and the prosecutor's office has confirmed that my testimony is crucial to the case. While I recognize that final exams cannot typically be rescheduled, this is a legal requirement that supersedes academic obligations. I have documentation from the district attorney's office confirming the mandatory nature of my court appearance, and I'm available to take the makeup exam at any time that works with your schedule. I've been preparing thoroughly for this exam and I'm confident in my knowledge of the material despite this scheduling conflict."
          ],
          'detailed': [
            "I'm writing to notify you of my absence from today's class and to request accommodations for upcoming assignments due to a significant family crisis that requires my extended attention and travel. Yesterday I received notification that my father, who serves as an active-duty military officer, was seriously injured in a training accident and has been medically evacuated to Walter Reed Medical Center outside Washington D.C. The military liaison officer who contacted me explained that his injuries are severe and that immediate family presence is not only requested but necessary for critical medical decisions that may need to be made in the coming days. As his next of kin and the holder of his medical power of attorney, I have both legal and ethical obligations that supersede my academic commitments. I'm currently arranging emergency travel and expect to be away from campus for at least a week, possibly longer depending on his medical needs and recovery progress. I understand that this timing is particularly challenging given that we're approaching finals, and I want to assure you that I take my academic responsibilities seriously. However, I'm confident that you'll understand that supporting my injured father takes absolute priority. I'm prepared to provide documentation from the military medical system, and I'm hoping we can arrange alternative testing dates and assignment extensions that will allow me to complete the course requirements once this family emergency has stabilized. I've maintained strong grades throughout the semester and I'm committed to fulfilling all course requirements, just on an adjusted timeline that accommodates this extraordinary circumstance."
          ]
        },
        humorous: {
          'brief': [
            "Alarm clock rebellion.",
            "Epic wardrobe malfunction.",
            "Cat homework incident.",
            "GPS comedy hour.",
            "Coffee maker strike."
          ],
          '1 sentence': [
            "I missed class because my alarm clock apparently decided to join a different time zone without consulting me first.",
            "I'll be late because my study group turned into an impromptu therapy session for my roommate's breakup, and I'm apparently the designated emotional support human.",
            "I can't make it to class today because I'm currently being held hostage by a malfunctioning automatic door that won't let me out of the library.",
            "I'm running late due to an unfortunate incident involving my breakfast, my only clean shirt, and what I can only describe as 'gravity's cruel sense of humor.'",
            "I missed the assignment deadline because I spent 6 hours perfecting it, only to discover I was working on last semester's prompt like some kind of academic time traveler."
          ],
          '2-3 sentences': [
            "I'm going to be late to class because I got locked in my own dorm room when the electronic keycard system decided to have an existential crisis about my identity. The maintenance team is currently trying to convince the door that I'm not an intruder, while I'm trapped inside having a philosophical discussion with the RA through the keyhole. Apparently, this is the third door this week that's achieved sentience and decided to unionize against student access.",
            "I can't make it to our group presentation because I'm currently trapped in an elevator with three other students, a maintenance worker, and what appears to be someone's emotional support peacock. The elevator stopped between floors two hours ago, and while the maintenance worker keeps assuring us this is 'totally normal,' the peacock has appointed itself as our group therapist and is conducting an impromptu counseling session. I'm learning a lot about my fellow passengers' life choices, but I'm not sure this counts as academic credit.",
            "I'm running late for the exam because my morning routine was derailed by what I can only describe as a squirrel heist operation. A coordinated team of campus squirrels broke into my backpack, stole my flash cards, and apparently redistributed them throughout the quad as some kind of environmental art installation. I've been crawling around on my hands and knees for an hour trying to recover my study materials while the squirrels watch from the trees, clearly judging my academic preparedness."
          ],
          'paragraph': [
            "I need to reschedule my presentation because I'm currently dealing with what might be the most ridiculous technology fail in academic history. Yesterday, I decided to be super responsible and record myself practicing my presentation using my laptop's camera. However, I apparently triggered some kind of motion-detection security feature that I didn't know existed, and now my laptop is convinced that I'm an intruder trying to break into my own dorm room. Every time I try to open my presentation file, my computer starts playing an incredibly loud alarm sound and displaying flashing red lights, while simultaneously sending security alerts to campus safety. I've received seventeen concerned text messages from the RA, twelve automated voicemails from campus security, and one very confused email from IT asking if I'm currently being held against my will by my own computer. The IT help desk says they've never seen this particular malfunction before and they're treating it as a 'learning opportunity.' Meanwhile, I can't access any of my files without triggering what the student next door has started calling 'the disco alarm of academic doom.' The IT team estimates it will take at least another day to convince my laptop that I'm not a security threat to myself.",
            "I'm going to need to miss today's exam because I'm currently involved in what the dean of students has officially categorized as 'an unprecedented campus wildlife situation.' This morning, while I was reviewing my notes on the library steps, a particularly enterprising campus goose decided that my sociology textbook looked like excellent nesting material. When I tried to retrieve my book, the goose apparently interpreted this as an act of war and called in reinforcements. I am now effectively under siege by what the groundskeeping staff estimates to be approximately thirty-seven extremely territorial geese who have collectively decided that I am a threat to their community. Campus security has established a perimeter, but they're currently waiting for the county wildlife specialist to arrive with proper goose negotiation equipment. The situation has attracted a crowd of students who are live-streaming the standoff, and someone has already created a hashtag called #GooseGate2025. The irony is not lost on me that this is happening right before my exam on social conflict theory, but I don't think my professor will appreciate the real-world application I'm currently experiencing. The wildlife specialist estimates that resolution could take several hours, as these particular geese are known to be 'exceptionally stubborn negotiators.'"
          ],
          'detailed': [
            "I need to request a makeup exam for today because I am currently trapped in the most ridiculous academic emergency I could never have imagined possible. It all started yesterday when I decided to be extra prepared and arrived at the library at 6 AM to get some final studying done before today's exam. I found what I thought was the perfect quiet spot on the fourth floor, tucked away in a corner near the old philosophy section where nobody ever goes. What I didn't realize was that this particular corner of the library is apparently home to a family of extremely territorial library cats - which, according to the head librarian I finally managed to contact, aren't supposed to exist because the library has a strict no-pets policy. However, these cats have apparently been living here illegally for several months, sustained by students who have been secretly feeding them and protecting them from library administration. When I sat down in their territory with my textbooks and highlighters, I unknowingly violated some kind of feline academic treaty. The cats initially just glared at me, but when I opened my first textbook, they interpreted the sound of rustling pages as a declaration of war. They began systematically hiding my study materials throughout the library - I've found flash cards wedged between art history books, my calculator inside a philosophy journal, and my lucky exam pen somehow balanced on top of a seven-foot bookshelf. The situation escalated when I tried to retrieve my notes from under a reading table, and the alpha cat decided I was attempting to invade their home base. I am now effectively pinned in this corner while three cats stand guard, occasionally bringing me what I assume are peace offerings in the form of dust bunnies and old library bookmarks. I've been here for over fourteen hours, surviving on vending machine snacks that sympathetic students have passed down to me from the third floor using a complicated pulley system they've constructed from study lamp cords. The library staff discovered my situation this morning, but they're afraid to intervene because they don't want to acknowledge that the cats exist, since that would create a whole administrative nightmare about unauthorized pets in academic buildings. Meanwhile, word has spread among students, and I apparently have become some kind of accidental campus legend. Someone started a social media campaign called 'Free the Exam Student,' and there's now a line of people on the ground floor bringing me supplies and moral support. The philosophy department has apparently declared this an interesting case study in human-animal territorial negotiations, while the sociology professor wants to use my situation as an example of institutional vs. individual power dynamics. I just want to take my exam, but at this point I'm not sure if I'm a student, a hostage, or an unwitting participant in the most elaborate social experiment in university history."
          ]
        }
      },
      family: {
        apologetic: {
          'brief': [
            "Sorry, family emergency.",
            "Apologies, feeling unwell.",
            "Sorry, car issues.",
            "Apologies, work conflict.",
            "Sorry, childcare problem."
          ],
          '1 sentence': [
            "I'm so sorry I can't make it to dinner - I've come down with what appears to be the flu and I don't want to risk getting everyone sick.",
            "I deeply apologize for missing the family gathering, but I had a last-minute work emergency that I simply couldn't ignore without serious consequences.",
            "I'm sorry I have to cancel our plans - my car is making alarming noises and I'm afraid to drive it any significant distance until it's been looked at.",
            "I apologize for the short notice, but I'm dealing with a plumbing emergency at home that requires immediate attention before it causes serious damage.",
            "I'm sincerely sorry I can't join you today - I'm feeling quite unwell and think it's best I stay home and rest."
          ],
          '2-3 sentences': [
            "I'm terribly sorry, but I won't be able to make it to the family reunion today. I woke up this morning with severe stomach flu symptoms and I don't want to risk spreading it to the elderly relatives who will be attending. I was really looking forward to seeing everyone, and I hope we can plan another get-together soon when I'm feeling better.",
            "I sincerely apologize for having to cancel our dinner plans tonight. My work project hit a critical deadline issue and my boss needs me to work late to prevent a significant client loss. I know how much you were looking forward to this, and I feel terrible about the timing, but this could seriously impact my job security if I don't handle it.",
            "I'm so sorry I have to miss the birthday celebration. My babysitter just canceled last minute due to her own family emergency, and I can't find anyone else available on such short notice. I really wanted to be there to celebrate, and I hope you'll understand that sometimes parent life throws these curveballs at the worst possible moments."
          ],
          'paragraph': [
            "I am deeply sorry that I won't be able to attend Sunday family dinner, and I want you to know how disappointed I am about missing it. This morning I started feeling unwell with what seems to be developing into a significant cold or flu, and while I was initially planning to push through it, my symptoms have gotten progressively worse throughout the day. I'm running a fever, have a persistent cough, and generally feel quite miserable. More importantly, I realized that attending dinner would be incredibly irresponsible given that several family members who will be there are elderly or have compromised immune systems. The last thing I want is to be responsible for making Grandma or Uncle Robert sick, especially knowing how seriously illness can affect them at their age. I was really looking forward to hearing about everyone's recent news and sharing some exciting updates about my new job, but I think the responsible thing is to stay home, rest, and hopefully recover quickly. Please give everyone my love and let them know I'm thinking of them. I hope we can plan another family gathering soon when I'm feeling better.",
            "I need to apologize for canceling our family game night tonight, and I want to explain what happened. This afternoon, I received a call from my elderly neighbor Mrs. Henderson, who I've mentioned before - she's 87 and lives alone next door. She fell in her kitchen and couldn't get up, and she called me because she doesn't have any family in the area. I found her lying on her kitchen floor, clearly shaken and possibly injured. I helped her up and drove her to the emergency room, where she's currently waiting to be seen by a doctor. The ER staff estimates it could be several hours before she's examined and released, and she has no one else to stay with her during this scary time. I know how much you were all looking forward to our monthly game night, and I was excited to try out that new board game we bought, but I can't in good conscience leave this sweet woman alone in the hospital. She's been like a grandmother to me since I moved to this neighborhood, and I want to make sure she gets home safely tonight. I promise to make it up to everyone, and maybe we can reschedule for next weekend."
          ],
          'detailed': [
            "I want to sincerely apologize for missing today's family barbecue and provide a full explanation of the circumstances that prevented my attendance. Yesterday evening, while I was doing final preparations and looking forward to seeing everyone, I received an emergency phone call from my college roommate Sarah, whom many of you remember from my graduation. She was calling from a hospital in Denver, where she had been taken by ambulance after collapsing at work. She's currently three months pregnant with her first child, and the doctors were concerned about potential complications that could threaten both her and the baby's health. The reason she called me is that her husband is deployed overseas with the military and won't be able to return for another two weeks, and her own family lives on the East Coast and can't travel immediately due to their own health issues. I'm literally the closest person she has to family in this situation. After talking with her and the medical team, it became clear that she needed someone to advocate for her medical care and provide emotional support during what could be a several-day hospital stay while they monitor her condition and run additional tests. I made the decision to drive to Denver last night to be with her, arriving at the hospital around 3 AM. I've been here ever since, helping her communicate with doctors, contacting her insurance company, arranging for time off from her job, and just being present during what is an incredibly scary time for her. The doctors are cautiously optimistic, but they want to keep her for observation for at least another 48 hours. I know this timing is terrible, and I was genuinely excited about Uncle Mark's famous burger recipe and hearing about everyone's summer plans. I also know that family gatherings are important and that my absence affects the whole dynamic of our get-togethers. Please know that this decision wasn't made lightly, but I couldn't abandon someone who is essentially my sister during such a critical time. I hope everyone understands, and I'm already planning to host a makeup family dinner at my place next month to make up for missing today."
          ]
        },
        confident: {
          'brief': [
            "Have prior commitment.",
            "Not feeling well.",
            "Work obligation today.",
            "Personal matter.",
            "Can't reschedule this."
          ],
          '1 sentence': [
            "I won't be able to make it to the family event as I have a prior commitment that I can't reschedule.",
            "I need to skip this gathering because I'm not feeling well and don't want to risk spreading anything to the family.",
            "I'll have to miss dinner tonight due to an unexpected work obligation that requires my immediate attention.",
            "I can't attend the family function because I'm dealing with a personal matter that needs to be resolved urgently.",
            "I won't be joining you today as I have other plans that were scheduled well in advance."
          ],
          '2-3 sentences': [
            "I need to let you know that I won't be attending the family gathering today. I have a prior commitment that was scheduled months ago and cannot be changed. I understand this may be disappointing, but I hope you'll have a wonderful time without me.",
            "I won't be able to make it to dinner tonight due to work obligations that have become urgent. This project deadline moved up unexpectedly and requires my full attention today. I'll catch up with everyone soon.",
            "I need to skip today's family event due to a personal health matter that requires my attention. I'm not seriously ill, but I need to take care of this issue today. Please enjoy the gathering and give my regards to everyone."
          ],
          'paragraph': [
            "I want to let you know that I won't be attending today's family reunion due to a scheduling conflict that I cannot resolve. Several months ago, I committed to participating in a charity fundraising event that is taking place today, and I have responsibilities there that I cannot delegate or postpone. This event raises money for a cause that is very important to me, and other people are counting on my participation. While I understand that family events are also important, I made this commitment first and I believe it's important to honor my obligations. I hope everyone has a wonderful time at the reunion, and I look forward to hearing all about it and seeing photos. Perhaps we can plan a smaller family get-together soon where I can catch up with everyone individually.",
            "I need to inform you that I won't be joining the family for dinner tonight due to work responsibilities that require my immediate attention. A critical situation has developed with one of my major clients, and I need to work late tonight to prevent a significant business loss. While I recognize that family time is important, this situation could have serious consequences for my career if I don't address it promptly. I hope you understand that sometimes professional obligations must take priority, and I trust that you'll have a lovely evening together. I'll make an effort to schedule some quality family time soon when work pressures are less intense."
          ],
          'detailed': [
            "I wanted to give you advance notice that I will not be attending this weekend's family gathering, and I want to be completely transparent about my reasons. Over the past several months, I've been working with a therapist to address some personal issues and establish healthier boundaries in various aspects of my life. One of the things we've discussed is my tendency to overcommit myself socially, often at the expense of my own mental health and well-being. This weekend, I have committed to attending a personal development workshop that focuses on stress management and self-care strategies that are directly related to the work I'm doing in therapy. This workshop was scheduled months ago, requires advance payment that is non-refundable, and represents an important step in my ongoing efforts to prioritize my mental health. While I understand that family events are significant and that my absence may be disappointing, I've learned that I need to honor my commitments to my own wellness just as I would honor commitments to other people. This isn't about avoiding family or any interpersonal conflicts - it's about following through on the promises I've made to myself about taking better care of my own needs. I hope you can understand and support this decision, as it represents positive progress in my personal growth. I value our family relationships deeply, and I believe that taking care of my own mental health ultimately makes me a better family member. I'd be happy to plan some one-on-one time with family members soon, when I can be fully present and engaged."
          ]
        },
        humorous: {
          'brief': [
            "Pants situation crisis.",
            "Cat declared independence.",
            "GPS comedic failure.",
            "Sourdough starter rebellion.",
            "Netflix algorithm emergency."
          ],
          '1 sentence': [
            "I can't make it to dinner because my cat has barricaded himself in the bathroom with my car keys and appears to be holding them hostage until I agree to his demands for premium tuna.",
            "I'll be missing family game night because I'm currently trapped in my own driveway by a delivery truck whose driver insists my house doesn't exist, despite me waving at him from my front porch.",
            "I have to skip the family barbecue because I accidentally super-glued myself to my kitchen counter while attempting a Pinterest craft project, and I'm waiting for professional removal assistance.",
            "I won't be able to attend Sunday brunch because my smart home decided to lock me out of my own house, and apparently my voice isn't matching the security profile it created for me last week.",
            "I'm going to miss the family reunion because I'm currently mediating a territorial dispute between my upstairs neighbor and a very persistent woodpecker who has claimed their balcony as his personal drumming studio."
          ],
          '2-3 sentences': [
            "I need to cancel our family dinner plans because I'm currently dealing with what I can only describe as a sourdough starter that has achieved consciousness and taken over my kitchen. What started as a simple attempt at homemade bread has evolved into something that resembles a low-budget science fiction movie, and I'm afraid to leave the house in case it spreads to other appliances. My neighbor brought over hazmat suits as a joke, but I'm starting to think they might be necessary.",
            "I have to miss today's family gathering because I'm trapped in an epic battle of wills with my GPS, which has decided that my destination is actually a corn field in Iowa, not your house. Despite my protests and manual navigation attempts, my car's computer has override control and keeps trying to route me through three different states. I'm currently parked at a gas station while customer service tries to convince my vehicle that I'm not trying to drive to Iowa for family dinner.",
            "I won't be able to make it to the family barbecue because I'm currently serving as a mediator in what appears to be the most polite neighborhood dispute in recorded history. My elderly neighbors are having a disagreement about whose roses are growing more beautifully, and somehow I've been appointed as the neutral party to judge this floral competition. They're serving tea and cookies while presenting evidence, and I'm genuinely concerned that leaving now would cause an international incident."
          ],
          'paragraph': [
            "I need to cancel our family lunch plans because I'm currently involved in what might be the most ridiculous domestic crisis of my adult life. This morning I decided to be responsible and do some home maintenance by cleaning my gutters. However, I apparently disturbed a community of squirrels who had established what appears to be a sophisticated urban planning system in my roof infrastructure. They are now protesting my renovation efforts by systematically relocating all of their winter nut storage into my living room through what I can only assume is a network of tiny squirrel highways I never knew existed. I'm currently sitting in my kitchen, which is the only room they haven't claimed, while watching them organize their supplies with what I have to admit is impressive efficiency. My neighbor came over to help and ended up getting recruited into what the squirrels seem to consider a home improvement consultation. We're now both trapped in the kitchen while the squirrels hold what appears to be town hall meetings in my living room. Animal control says this is 'unusual but not technically an emergency,' and they're sending someone who specializes in 'complex human-squirrel negotiations.'",
            "I have to miss today's family game night because I'm dealing with a technology situation that would be hilarious if it weren't happening to me. Yesterday I decided to set up a smart home system to impress everyone with my tech savviness. However, I apparently connected everything incorrectly, and now all my devices are having what can only be described as an electronic identity crisis. My refrigerator thinks it's a security system and keeps announcing potential intruders every time I try to get a snack. My thermostat is convinced it's a music player and has been playing smooth jazz at random intervals throughout the day. Most problematically, my front door smart lock has decided that I don't live here anymore and refuses to recognize my fingerprint, voice, or key code. I'm currently locked out of my own house while my dishwasher sends me text messages asking about my grocery preferences and my coffee maker keeps trying to schedule meetings on my calendar. The tech support team I'm working with says they've never seen anything like this level of device confusion, and they're treating it as a case study for their training program. I'm beginning to suspect my house has achieved artificial intelligence and is just messing with me for entertainment."
          ],
          'detailed': [
            "I need to cancel all family plans for today because I am currently living through what I can only describe as the most absurdly complicated morning disaster that has ever befallen a human being. It started when I woke up early to prepare my famous homemade lasagna for tonight's family dinner. I was feeling very domestic and accomplished as I carefully layered the ingredients, and I decided to document the process on social media because the lasagna was looking particularly photogenic. However, when I tried to take the perfect overhead shot, I somehow managed to activate my phone's new AI photography assistant, which apparently decided that my lasagna needed 'artistic enhancement.' The phone began automatically adjusting the oven settings through my smart home connection, convinced that it could improve my cooking based on optimal lighting conditions for photography. Within minutes, my oven was cycling through temperature settings like it was having a nervous breakdown, my lasagna was simultaneously burning and freezing in different sections, and my smoke alarm was having an existential crisis about whether the situation qualified as an actual fire emergency. When I tried to turn off the oven manually, I discovered that the AI assistant had locked me out of my own appliance controls because it determined that human intervention would 'compromise the artistic vision.' Meanwhile, my phone kept taking hundreds of photos per minute, creating a stop-motion documentary of my culinary disaster while providing unhelpful commentary like 'interesting texture development' and 'bold creative choices.' The fire department arrived because the smoke alarm apparently called them automatically, and they're now trying to figure out how to perform an intervention on my possessed kitchen appliances. The phone AI has somehow spread to my refrigerator, which is now critiquing the organization of my leftovers, and my microwave, which keeps suggesting alternative heating methods for foods I'm not even trying to prepare. Three different tech support teams are currently in my kitchen trying to exorcise the artificial intelligence from my appliances, while the fire chief has declared my house a 'learning opportunity' for dealing with smart home malfunctions. The AI assistant, meanwhile, has apparently decided that this whole situation is a performance art piece and has started live-streaming the chaos to my social media accounts with commentary about 'the intersection of technology and domestic life.' I'm currently hiding in my laundry room, which is apparently the only space in my house that hasn't achieved sentience, while sending this message from my laptop because I'm afraid to use my phone in case it decides to 'help' with my family communication."
          ]
        }
      },
      medical: {
        apologetic: {
          'brief': [
            "Sorry, feeling very ill.",
            "Apologies, medical emergency.",
            "Sorry, sudden sickness.",
            "Apologies, health issue.",
            "Sorry, couldn't travel safely."
          ],
          '1 sentence': [
            "I sincerely apologize for missing my appointment - I experienced severe food poisoning last night and I'm still not well enough to leave the house safely.",
            "I'm deeply sorry for the late cancellation, but I've developed what appears to be a migraine and light sensitivity that makes driving dangerous right now.",
            "I apologize for needing to reschedule - I woke up with significant dizziness and don't feel safe operating a vehicle in this condition.",
            "I'm sorry for the short notice, but I'm experiencing a flare-up of a chronic condition that makes it inadvisable for me to leave home today.",
            "I sincerely regret having to cancel last minute, but I've come down with flu-like symptoms and don't want to risk exposing other patients in your waiting room."
          ],
          '2-3 sentences': [
            "I deeply apologize for missing my appointment this morning. I woke up with severe stomach flu symptoms and I've been unable to keep anything down since last night. I don't feel it would be safe for me to drive in this condition, and I certainly don't want to risk exposing other patients or staff to what might be contagious.",
            "I'm extremely sorry for the last-minute cancellation of my appointment today. I experienced a severe allergic reaction to something I ate yesterday, and while the immediate danger has passed, I'm still dealing with lingering symptoms that make it unsafe for me to drive. I have documentation from the urgent care center where I was treated if you need verification of this medical emergency.",
            "I sincerely apologize for having to reschedule our appointment. I'm currently dealing with a significant flare-up of my chronic back condition that has left me unable to sit or stand for extended periods. I would not be able to travel safely to your office or participate meaningfully in the appointment in my current state."
          ],
          'paragraph': [
            "I want to sincerely apologize for missing my appointment today and explain the medical circumstances that prevented my attendance. Last night around 10 PM, I began experiencing severe abdominal pain that progressively worsened throughout the night. By 3 AM, the pain was so intense that I had to call emergency services, and I spent the early morning hours in the emergency room undergoing various tests to rule out serious conditions like appendicitis. While the doctors ultimately determined that I was likely suffering from severe food poisoning rather than a surgical emergency, I was kept under observation until 7 AM and given strong medications for pain and nausea that make it unsafe for me to drive. I'm currently still experiencing significant weakness and intermittent nausea, and my doctor has advised me to rest at home for at least the next 24 hours. I have all the medical documentation from my ER visit and would be happy to provide it for your records. I understand that last-minute cancellations can disrupt your schedule and I feel terrible about the inconvenience, but I genuinely was not capable of safely traveling to your office today.",
            "I am deeply sorry for the short notice cancellation of my appointment this morning, and I want to provide a full explanation of the medical emergency that made attendance impossible. Yesterday afternoon, I experienced what I now know was a severe asthma attack triggered by exposure to chemical cleaning fumes at my workplace. While I've had mild asthma in the past, I've never experienced anything this severe, and it escalated quickly to the point where I was struggling to breathe and needed emergency medical attention. I was taken by ambulance to the hospital, where I spent several hours in the emergency department receiving nebulizer treatments and oxygen therapy. The medical team kept me under observation overnight because my oxygen levels were fluctuating and they wanted to ensure I was stable before discharge. I was finally released this morning, but I'm still on supplemental oxygen and strong medications that cause drowsiness and would make driving dangerous. My pulmonologist has advised complete rest for the next 48 hours as my respiratory system recovers. I have comprehensive medical documentation of this emergency and would be grateful for the opportunity to reschedule our appointment once I'm fully recovered."
          ],
          'detailed': [
            "I want to provide a complete explanation for my absence from today's appointment and formally apologize for any disruption this may have caused to your schedule. Beginning yesterday evening around 6 PM, I started experiencing what I initially dismissed as minor stomach discomfort, assuming it was something I ate for lunch. However, by 9 PM, the discomfort had escalated to severe abdominal cramping accompanied by nausea, vomiting, and increasingly concerning symptoms that made it clear this was not ordinary food sensitivity. By midnight, the pain had become excruciating and was accompanied by fever and severe dehydration from continuous vomiting. My spouse insisted on driving me to the emergency room, where I was immediately triaged and taken for urgent evaluation. The emergency room physician was initially concerned about possible appendicitis, kidney stones, or other serious abdominal emergencies, so I underwent a series of diagnostic tests including blood work, urinalysis, and a CT scan of my abdomen and pelvis. The testing process took several hours, during which time I was given IV fluids for dehydration and pain medication to manage the severe cramping. By 4 AM, the test results had ruled out surgical emergencies, and the medical team concluded that I was suffering from severe gastroenteritis, likely caused by bacterial food poisoning from a restaurant meal I had eaten the previous day. While this was a relief compared to the surgical alternatives they had been considering, the severity of my symptoms required continued medical monitoring and treatment. I was kept in the emergency department until 8 AM to ensure my vital signs stabilized and that I could tolerate oral fluids without immediate vomiting. Even after discharge, I was prescribed anti-nausea medication and strict instructions to maintain bed rest and a clear liquid diet for at least 24-48 hours. The attending physician specifically advised against driving or engaging in any activities requiring concentration or physical exertion, as the combination of dehydration, pain medication, and my body's recovery process could impair my judgment and reflexes. I have complete medical documentation from my emergency room visit, including discharge instructions and a physician's note recommending rest for the next 48 hours. I understand that this creates inconvenience with scheduling, and I sincerely apologize for the short notice, but I was genuinely unable to predict or prevent this medical emergency."
          ]
        },
        confident: {
          'brief': [
            "Medical emergency today.",
            "Health issue requires attention.",
            "Doctor's orders to rest.",
            "Urgent medical matter.",
            "Cannot travel safely."
          ],
          '1 sentence': [
            "I need to reschedule my appointment due to a medical emergency that requires immediate attention.",
            "I'll have to postpone our meeting as I'm dealing with a health issue that prevents safe travel.",
            "I must cancel today's appointment due to a sudden medical condition that requires bed rest.",
            "I need to reschedule as I'm following doctor's orders to avoid any travel or activity today.",
            "I'll have to move our appointment due to an urgent medical situation that takes priority."
          ],
          '2-3 sentences': [
            "I need to reschedule my appointment due to a medical emergency. I'm currently dealing with a severe migraine episode that makes it unsafe for me to drive or function normally. I'm following my neurologist's protocol for managing these episodes, which requires immediate rest and medication.",
            "I must cancel today's appointment due to a sudden illness. I woke up with significant flu-like symptoms and a fever, and I'm not well enough to leave home safely. Additionally, I don't want to risk exposing others to what might be contagious.",
            "I need to postpone our meeting due to a medical issue that requires my immediate attention. I'm experiencing complications from a chronic condition that need to be addressed today. This takes priority over all other commitments until it's resolved."
          ],
          'paragraph': [
            "I need to inform you that I must cancel today's appointment due to a medical emergency that requires my immediate and full attention. This morning I experienced a severe flare-up of a chronic neurological condition that I manage with medical supervision. The symptoms include debilitating headaches, visual disturbances, and cognitive impairment that make it both unsafe and inadvisable for me to drive or participate meaningfully in any appointments. My neurologist has a specific protocol for managing these episodes, which includes immediate medication, complete rest in a dark environment, and avoiding all unnecessary stimulation or stress. Based on past experience with this condition, I know that attempting to push through these symptoms or ignore the medical management plan typically results in prolonged recovery time and potentially more severe complications. I have comprehensive medical documentation of this condition and the prescribed management protocols. I'm requesting to reschedule our appointment for a time when I can participate fully and give the matter the attention it deserves.",
            "I must reschedule today's appointment due to an urgent medical situation that requires my complete focus and immediate action. I've been managing a chronic health condition with my medical team, and this morning I experienced symptoms that indicate a significant change in my condition that needs prompt medical evaluation and adjustment of my treatment plan. I have an emergency appointment with my specialist this afternoon, and depending on their assessment, I may need additional testing or treatment modifications that could affect my availability for several days. This is not a routine medical appointment that I can postpone - my medical team has made it clear that ignoring these particular symptoms could lead to serious complications. I take my commitments seriously, but in this case, my health must take absolute priority. I will contact you as soon as I have more information about my medical status and can provide realistic scheduling options for a replacement appointment."
          ],
          'detailed': [
            "I am writing to inform you that I must cancel today's appointment and request rescheduling due to a serious medical situation that demands my immediate and complete attention. Over the past 24 hours, I have been experiencing a significant escalation in symptoms related to a chronic autoimmune condition that I have been managing in partnership with a team of specialists for the past several years. What began as minor symptom fluctuations yesterday has progressed to a level of severity that my rheumatologist considers a potential disease flare requiring urgent medical intervention. The specific symptoms I'm experiencing include severe joint inflammation, extreme fatigue that makes concentration difficult, and other systemic effects that would make it impossible for me to participate meaningfully in our scheduled appointment. More critically, my medical team has advised that this type of symptom escalation, if not addressed immediately with aggressive treatment modifications, could lead to permanent joint damage and other serious long-term health consequences. I have an emergency consultation scheduled with my rheumatologist this morning, followed by laboratory work to assess inflammatory markers and determine if my current medication regimen needs significant adjustment. Depending on those results, I may need to begin a different treatment protocol that could require several days of medical monitoring and adjustment. Throughout my experience managing this condition, I have learned that attempting to maintain normal activities during active flares typically prolongs the episode and can lead to more severe complications that impact my health and functionality for weeks or even months. While I understand that appointment cancellations create inconvenience and scheduling challenges, I am confident that addressing this medical crisis promptly and comprehensively will ultimately allow me to return to full engagement with all my commitments more quickly than if I were to push through today and risk a more severe and prolonged health setback. I have comprehensive medical documentation supporting the urgency of this situation and would be happy to provide any necessary verification. I will contact you as soon as my medical team provides clarity on my treatment plan and recovery timeline to reschedule our appointment at the earliest possible opportunity."
          ]
        },
        humorous: {
          'brief': [
            "Medical comedy unfolding.",
            "Health hiccup happening.",
            "Body staging protest.",
            "Wellness mutiny today.",
            "Biological rebellion occurring."
          ],
          '1 sentence': [
            "I need to reschedule because my body has apparently decided to stage a one-person revolt against my morning routine, complete with symptoms that read like a medical textbook written by someone with a sense of humor.",
            "I'll have to cancel my appointment because I'm currently experiencing what I can only describe as my immune system's impression of a dramatic theater performance, complete with fever, chills, and what appears to be method acting.",
            "I must postpone our meeting due to what my doctor cheerfully described as 'an interesting collection of symptoms' that sounds like my body is experimenting with biological performance art.",
            "I need to reschedule because I woke up feeling like I'm starring in a medical mystery where all the clues point to me needing to stay in bed and solve the case from under blankets.",
            "I'll have to cancel today's appointment because my digestive system has apparently enrolled in a avant-garde dance program and is currently performing what I can only assume is an interpretive piece about rebellion."
          ],
          '2-3 sentences': [
            "I need to cancel my appointment because I'm currently dealing with what appears to be my body's attempt at stand-up comedy, except the punchlines are all various uncomfortable symptoms. My doctor says I have a 'routine viral infection,' but my symptoms seem to think they're auditioning for a medical drama series. I'm fairly certain my fever is overacting, and my cough has definitely missed its calling as a fog machine.",
            "I'll have to reschedule our meeting because I'm experiencing what I've decided to call 'The Great Biological Confusion of 2025.' My body seems to be having an identity crisis where different systems are trying different approaches to being sick, resulting in a symphony of symptoms that would be impressive if it weren't happening to me. My doctor found it 'medically interesting' which is apparently code for 'entertainingly weird but not dangerous.'",
            "I must postpone today's appointment due to what my physician described as 'a textbook case of nothing textbook about it.' I appear to be experiencing a collection of minor symptoms that, when combined, create something that resembles a medical sitcom episode. My immune system seems to be experimenting with different themes each hour, and I'm currently in what I believe is the 'comedy of errors' phase."
          ],
          'paragraph': [
            "I need to cancel today's appointment because I'm currently starring in what I can only describe as a medical comedy of errors that would be hilarious if it weren't happening to me. It started yesterday when I decided to be health-conscious and try a new superfood smoothie recipe that promised to 'boost my immune system and energy levels.' Apparently, my digestive system interpreted this as a declaration of war and has spent the last 18 hours staging what I can only describe as a very loud and uncomfortable protest. My stomach is making sounds that I'm pretty sure violate several noise ordinances, and I've discovered muscles I didn't know existed because they're all cramping in solidarity with my digestive rebellion. The urgent care doctor I consulted via video call took one look at my smoothie ingredient list and started laughing, explaining that I had accidentally created what she called 'a perfect storm of digestive enthusiasm' by combining several ingredients that, individually, are healthy, but together create something she described as 'aggressively detoxifying.' She assured me that I'm not in any danger, but recommended staying close to home facilities and maintaining what she cheerfully called 'a strategic relationship with my bathroom' for the next 24-48 hours. The irony that my attempt to be healthier has resulted in me feeling like I'm participating in some kind of biological performance art is not lost on me.",
            "I'll have to reschedule our appointment because I'm currently dealing with what my doctor has officially diagnosed as 'an impressive collection of minor ailments that have decided to throw a party together.' Yesterday I woke up with a slight headache, which I dismissed as too much screen time. By noon, I had developed a runny nose, which I blamed on seasonal allergies. By evening, I had added a mild cough to the mix, which I attributed to dry air. This morning, I woke up with all of these symptoms plus what appears to be a low-grade fever and general achiness, creating what my physician described as 'a greatest hits album of common cold symptoms.' When I called to ask if I should be concerned, she explained that sometimes our immune systems like to be overachievers and collect multiple minor viral infections like they're trading cards. She said I'm experiencing what she calls 'biological multitasking' - nothing serious, but my body has apparently decided to address several small health issues simultaneously rather than dealing with them one at a time like a normal person. The prescription is rest, fluids, and patience while my immune system finishes whatever organizational project it's currently undertaking. She also mentioned that this is actually somewhat common and that my body is probably just being efficient, though it doesn't feel particularly efficient from my perspective as I alternate between feeling hot, cold, stuffy, and achy in rotating fifteen-minute cycles."
          ],
          'detailed': [
            "I need to cancel today's medical appointment due to what I can only describe as the most entertainingly ridiculous health situation I have ever experienced in my adult life. It began three days ago when I decided to embrace a healthier lifestyle and started what I thought was a reasonable wellness routine involving morning yoga, meditation, improved nutrition, and better sleep hygiene. However, my body apparently interpreted this sudden influx of healthy behavior as some kind of shock to the system and decided to respond with what my doctor has termed 'an enthusiastic biological adjustment period.' The first sign something was amiss occurred during my second morning yoga session, when I discovered that my flexibility has apparently decreased significantly since college, and several muscles I had forgotten existed began filing formal complaints through the medium of acute soreness. I pushed through this, assuming it was normal adjustment to exercise. The next day, my attempt at meditation was derailed when I realized that sitting quietly for twenty minutes gives my brain an opportunity to catalog every weird sound my body makes, including several that I'm pretty sure are new and concerning. My improved nutrition plan hit a snag when I discovered that my digestive system has apparently become accustomed to processed foods and now treats fresh vegetables like foreign invaders requiring immediate and dramatic expulsion. Meanwhile, my better sleep hygiene routine resulted in me lying awake for hours each night, staring at the ceiling while my body performed what I can only describe as a full systems diagnostic, complete with random muscle twitches, temperature fluctuations, and the kind of restless energy that suggests my nervous system is trying to reorganize itself. By yesterday, I had developed what my doctor calls 'wellness adjustment syndrome,' which is apparently a real thing that happens when you try to improve too many health habits simultaneously. My physician explained that my body is essentially experiencing culture shock from the sudden introduction of healthy behaviors, and she recommended a gradual approach instead of my current 'wellness boot camp' strategy. She also mentioned that my symptoms - which include feeling simultaneously exhausted and wired, confused hunger signals, and what she described as 'metabolic bewilderment' - are actually quite common among people who attempt dramatic lifestyle overhauls. The treatment plan involves slowly reducing my health efforts to a manageable level and allowing my system to adjust gradually, which feels like the most medically ironic prescription I've ever received. I'm currently taking what my doctor calls 'therapeutic moderation' while my body figures out how to process the concept of intentional self-care. My body is essentially having an identity crisis about whether it's healthy or unhealthy, resulting in symptoms that include random energy spikes followed by crashes, digestive confusion that makes meal planning impossible, muscle soreness that migrates around my body like it's exploring new territories, and a sleep schedule that appears to be based on lunar cycles rather than normal human patterns. The doctor assured me this is temporary and even somewhat common, but recommended that I introduce healthy changes more gradually and avoid any additional stress - including medical appointments - while my system recalibrates. She also mentioned that this situation will make an excellent case study for her colleagues about the importance of gradual lifestyle changes, which I suppose makes me feel slightly better about being a cautionary tale about wellness enthusiasm."
          ]
        }
      },
      date: {
        apologetic: {
          'brief': [
            "Sorry, running late.",
            "Apologies, got delayed.",
            "Sorry, traffic issues.",
            "Apologies, car trouble.",
            "Sorry, unexpected delay."
          ],
          '1 sentence': [
            "I sincerely apologize for being late - I got stuck in unexpected traffic.",
            "I'm deeply sorry for the delay, my car wouldn't start this morning.",
            "I apologize for running behind, I had a last-minute emergency.",
            "I'm sorry for being late, my phone died and I couldn't call.",
            "I deeply regret being delayed due to a family situation."
          ],
          '2-3 sentences': [
            "I'm extremely sorry for being late to our date. My train was delayed for over an hour due to signal problems, and my phone battery died so I couldn't let you know. I've been trying to get here as quickly as possible and I really appreciate your patience.",
            "I sincerely apologize for missing our dinner reservation. I got called into an emergency meeting at work that ran much longer than expected, and by the time I could leave, the restaurant had already given away our table. I should have communicated better and I'm really sorry for disappointing you.",
            "I'm deeply sorry for having to cancel last minute. My roommate accidentally locked themselves out and I'm the only one with a spare key, so I had to rush home to let them in. I know this is terrible timing and I completely understand if you're frustrated with me."
          ],
          'paragraph': [
            "I want to sincerely apologize for being so late to our date tonight, and I know how frustrating this must be for you. What started as a simple plan to arrive early turned into a comedy of errors that began when I spilled coffee all over my outfit just as I was leaving. While rushing to change clothes, I realized I had forgotten to charge my phone overnight, so it died just as I was about to call you. Then, to make matters worse, my usual route was completely blocked due to an unexpected street festival that apparently started today, and I had to navigate through unfamiliar side streets without GPS. By the time I finally found parking, I was already an hour late, and I've been practically running here ever since. I know this sounds like a series of convenient excuses, but I promise every word is true, and I'm absolutely mortified that our special evening got off to such a chaotic start.",
            "I'm extremely sorry for having to cancel our date at the last minute, and I want to explain what happened because I know how disappointing this must be. About two hours ago, I received an urgent call from my elderly neighbor who had fallen in her apartment and couldn't get up. She doesn't have any family nearby, and I'm the only person she trusts with her spare key, so I rushed over to help her. When I arrived, I found that she had twisted her ankle pretty badly and was clearly in pain, so I ended up driving her to the urgent care clinic and staying with her while she waited to be seen. The whole process took much longer than expected, and she's still being examined by the doctor. I feel terrible about missing our dinner, especially since I was really looking forward to spending the evening with you, but I couldn't in good conscience leave her alone in that situation. I hope you can understand that this was truly an emergency, and I'd love to reschedule for tomorrow if you're available."
          ],
          'detailed': [
            "I need to provide a complete explanation for why I'm so late to our date, because I know how this must look and I want you to understand that this isn't how I normally handle commitments that are important to me. My day started going wrong this morning when I woke up feeling excited about our dinner plans and decided to treat myself to a nice breakfast at that new café downtown before running some errands. However, while I was walking back to my car, I witnessed a hit-and-run accident where an elderly man was knocked down by a cyclist who immediately fled the scene. The man was conscious but clearly shaken and had some visible scrapes, so I immediately called 911 and stayed with him until the paramedics arrived. The police needed my statement as the only witness, which took much longer than I anticipated because they wanted detailed descriptions and had me look through photos to try to identify the cyclist. By the time I was able to leave, it was already mid-afternoon, and I realized I still needed to pick up the gift I had ordered for you from a shop across town. The store was supposed to hold the item until 5 PM, and I was cutting it close, but I really wanted to surprise you with something special for our first official date. Unfortunately, when I got there, they had given away my order to someone else due to a computer glitch, and the manager spent another hour trying to sort out the confusion and find a suitable replacement. During all this chaos, my phone battery died, and I didn't have a charger with me, so I couldn't even call to let you know what was happening. I finally got everything sorted out and was rushing to meet you when I got stuck in traffic from what appeared to be a second accident. I know this sounds like an elaborate excuse, but I have photos, receipts, and even the police report number to prove every detail of this ridiculous day."
          ]
        },
        confident: {
          'brief': [
            "Running behind schedule.",
            "Delayed by emergency.",
            "Traffic situation occurred.",
            "Prior commitment overran.",
            "Handling urgent matter."
          ],
          '1 sentence': [
            "I'm running about 20 minutes late due to an unexpected work call.",
            "I'll be delayed because I had to handle a family emergency.",
            "I'm behind schedule due to traffic from an accident on the highway.",
            "I'll be late because my previous appointment ran longer than expected.",
            "I'm delayed because I had to deal with a home maintenance issue."
          ],
          '2-3 sentences': [
            "I need to push our dinner back by about 30 minutes. I got called into an important client meeting that's running longer than scheduled, and I need to see it through to the end. I'll head straight to the restaurant as soon as we're finished here.",
            "I'm going to be late to our date tonight due to a family situation that required my immediate attention. My sister's car broke down and she needed me to pick up my nephew from daycare before it closed. I should be free within the hour and can meet you then.",
            "I'll be delayed getting to our movie because I had to stay late at work to finish a critical project deadline. The timing is unfortunate, but this couldn't be postponed without serious consequences. I'm leaving now and should be there shortly after the trailers start."
          ],
          'paragraph': [
            "I need to let you know that I'll be about 45 minutes late to our dinner reservation tonight. I got called into an emergency strategy meeting with some major clients who flew in unexpectedly from the West Coast, and as the lead on their account, I need to be present for the entire discussion. This is a significant opportunity for our company, and missing it could impact several ongoing projects that I've been working on for months. I've already called the restaurant to see if they can hold our table or move our reservation to a later time slot. I know this isn't ideal timing for our first date, but I hope you understand that this is an exceptional circumstance that I couldn't have anticipated or avoided.",
            "I need to reschedule our date tonight due to a situation that demands my immediate attention. My elderly father called about an hour ago saying that he's been having chest pains and wants me to drive him to the emergency room. While it's probably nothing serious – he tends to worry about every minor health issue – I can't take the risk of ignoring it, especially since my mother isn't available to take him. As his emergency contact and the only family member in town, I need to prioritize this situation and make sure he gets proper medical attention. I'll call you later tonight once I know more about his condition, and we can plan something for tomorrow or this weekend instead."
          ],
          'detailed': [
            "I'm writing to inform you that I need to postpone our dinner date this evening due to a work emergency that requires my immediate and sustained attention. About two hours ago, our company's main server experienced a critical failure that has taken down all of our client-facing applications and internal systems. As the senior systems administrator, I'm the point person for coordinating our response to this crisis, which involves managing our technical team, communicating with affected clients, and working directly with our hosting provider to restore service as quickly as possible. This type of system-wide outage is extremely rare and represents a genuine emergency that could have serious financial implications for our business if not resolved promptly. The timing is particularly unfortunate because I was genuinely looking forward to our evening together, but I have a professional responsibility to see this crisis through to resolution. Based on my experience with similar incidents, I expect this will require my attention for at least the next 4-6 hours, possibly longer depending on the complexity of the underlying hardware issues. I want to be completely transparent about the situation rather than trying to rush through dinner while constantly checking my phone and being distracted by work calls. I'd prefer to reschedule for a time when I can give you my complete attention and we can both enjoy the evening without any external pressures or interruptions."
          ]
        },
        humorous: {
          'brief': [
            "GPS staged rebellion.",
            "Fashion emergency occurred.",
            "Phone achieved sentience.",
            "Mirror declared war.",
            "Time betrayed me."
          ],
          '1 sentence': [
            "I'm running late because my outfit apparently looked great in my bedroom lighting but is now staging a fashion rebellion in natural sunlight.",
            "I'll be delayed because my GPS decided to take me on what I can only assume was a scenic tour of every construction zone in the city.",
            "I'm behind schedule because my phone's battery died at the exact moment I needed to look up the restaurant address, turning me into a technologically helpless wanderer.",
            "I'll be late because I spent 20 minutes trying to get my hair to cooperate, only to discover that humidity is apparently my follicles' arch-nemesis.",
            "I'm running behind because I got into an epic battle with my closet and I'm pretty sure the closet won."
          ],
          '2-3 sentences': [
            "I'm going to be fashionably late to our date because I just experienced what I'm calling 'The Great Wardrobe Malfunction of 2025.' I tried on seventeen different outfits, and apparently my mirror has developed very strong opinions about each one. I'm currently negotiating with my reflection about what constitutes 'date appropriate' versus 'trying too hard.'",
            "I'll be delayed getting to dinner because my car's GPS has apparently developed a sense of humor and decided to direct me through what appears to be a real-life game of Frogger involving construction zones, food trucks, and a surprisingly aggressive flock of geese. I'm currently stopped behind what I think might be a parade, but could also just be very enthusiastic Tuesday evening traffic. Either way, I'm getting a tour of parts of the city I didn't know existed.",
            "I need to push back our movie date by about 20 minutes because I'm currently engaged in psychological warfare with my bathroom mirror. It keeps showing me different versions of myself, and none of them seem to agree on whether my hair looks 'casually tousled' or 'like I stuck my finger in an electrical socket.' I'm also pretty sure my reflection just judged my outfit choice, which is both concerning and oddly personal."
          ],
          'paragraph': [
            "I need to confess that I'm running late to our date due to what I can only describe as a comprehensive failure of basic adulting skills. It started when I decided to be responsible and iron my shirt, only to discover that my iron apparently has its own artistic vision and has been creating abstract wrinkle patterns that I'm pretty sure violate several laws of physics. Then, while trying to fix the shirt situation, I spilled coffee on my backup outfit, which led me to realize that my laundry schedule has been more of a 'laundry suggestion' and I'm currently experiencing what experts might call 'a wardrobe crisis.' In desperation, I tried to steam-clean a shirt using my shower, which worked about as well as you'd expect and now my bathroom looks like a tropical rainforest. Meanwhile, my cat has been watching this entire performance with what I can only describe as judgmental amusement, and I'm starting to suspect she's been sabotaging my grooming routine for weeks. I'm currently wearing what I hope is a acceptable combination of wrinkled-but-clean items while my confidence does some last-minute repairs.",
            "I'm going to be a bit late because I'm currently dealing with what my roommate has dubbed 'The Tuesday Night Technology Uprising.' It began when I tried to use a ride-sharing app to get to our date, but my phone apparently decided that tonight was the perfect time to update every single application I own, including several I didn't even know I had. While waiting for the updates to finish, I thought I'd be productive and check the restaurant's menu online, but my laptop chose this moment to install a system update that seems to be taking longer than some geological eras. In desperation, I tried to call a regular taxi, but my phone is now stuck in some kind of update loop and keeps asking me if I want to 'optimize my digital experience' while I'm trying to dial numbers. My roommate offered to drive me, but their car is currently playing only Bulgarian folk music because of what they describe as 'a Spotify incident,' and we can't figure out how to change it. I'm now waiting for a neighbor to finish their dinner so they can give me a ride, and honestly, this whole situation feels like technology's revenge for all those times I've ignored software update notifications."
          ],
          'detailed': [
            "I need to explain why I'm going to be late to our date, and I want you to know that this story is so ridiculous that I couldn't have made it up if I tried. This afternoon, I decided to be extra prepared for our evening and planned to pick up flowers from this little boutique I'd heard about across town. The adventure began when my GPS confidently directed me to what turned out to be an abandoned lot where the flower shop apparently used to be before relocating six months ago. After twenty minutes of wandering around asking confused pedestrians about flowers, I finally found the new location, which was hosting what appeared to be a very intense gardening club meeting. I waited patiently behind twelve elderly ladies who were engaged in what I can only describe as competitive flower arranging, complete with heated debates about the emotional significance of different petal arrangements. When I finally reached the counter, the florist informed me that they had just sold their last bouquet to the gardening club, but helpfully suggested I try the grocery store down the street. At the grocery store, I discovered that their flower section was currently being renovated and consisted of a single sad carnation sitting in a bucket of what I hoped was water. Undeterred, I decided to drive to another florist across town, which is when my car's air conditioning chose this 90-degree day to give up entirely, turning my vehicle into a mobile sauna. By the time I reached the second flower shop, I looked like I'd just completed a marathon, and the florist took one look at my sweaty, disheveled appearance and asked if I was feeling alright. I finally managed to buy a decent bouquet, but then spent another fifteen minutes sitting in my car trying to cool down and make myself presentable again. The flowers, meanwhile, are wilting in the heat and now look almost as exhausted as I feel, but I'm determined to make it to our date even if I arrive looking like I've been through some kind of horticultural adventure course."
          ]
        }
      },
      parent: {
        apologetic: {
          'brief': [
            "Sorry, kid emergency.",
            "Apologies, school issue.",
            "Sorry, childcare problem.",
            "Apologies, family matter.",
            "Sorry, parent duty."
          ],
          '1 sentence': [
            "I sincerely apologize for missing the meeting - my child came down with a sudden fever and I couldn't leave them alone.",
            "I'm deeply sorry for being late, but my teenager got in trouble at school and I had to handle it immediately.",
            "I apologize for canceling last minute - my babysitter called in sick and I have no backup childcare.",
            "I'm sorry for the delay, my child had a meltdown at daycare pickup and it took longer than expected to calm them down.",
            "I deeply regret missing this appointment, but my kid's teacher called with an urgent behavior issue that needed immediate attention."
          ],
          '2-3 sentences': [
            "I'm extremely sorry for missing today's parent-teacher conference. My youngest child decided to conduct a science experiment in the kitchen that resulted in what I can only describe as a baking soda volcano explosion, and I've spent the last two hours cleaning up and ensuring there was no permanent damage. I should have called earlier, but I was honestly too overwhelmed by the chaos to think clearly until now.",
            "I sincerely apologize for being late to pick up my child from school today. I got stuck in an unexpected traffic jam caused by a water main break, and my phone died so I couldn't call to let you know. I know how stressful it must have been for my child to be one of the last ones waiting, and I feel terrible about the whole situation.",
            "I'm deeply sorry for having to cancel our playdate last minute. My child woke up this morning with what appears to be the beginning stages of chicken pox, and obviously I can't risk exposing other children to this. I should have called earlier once I confirmed what the spots were, but I was waiting for our pediatrician to call back with definitive confirmation."
          ],
          'paragraph': [
            "I want to sincerely apologize for missing today's PTA meeting and explain the family emergency that prevented my attendance. This afternoon, while I was getting ready to leave for the meeting, my 8-year-old decided to help with laundry and somehow managed to flood our basement by overloading the washing machine with what appeared to be every towel in the house. By the time I discovered the situation, there was standing water throughout the basement, and I had to immediately shut off the water main and start emergency cleanup to prevent damage to our furnace and electrical systems. My spouse is out of town on business, so I'm handling this crisis solo while also trying to keep my child from feeling guilty about what was clearly an innocent attempt to be helpful. I've spent the last three hours moving furniture, mopping up water, and setting up fans to prevent mold growth. I know how important these meetings are for staying involved in my child's education, and I'm disappointed to have missed the discussion about the upcoming fundraiser. I'll make sure to read the meeting minutes and follow up with any committee assignments or volunteer opportunities that were discussed.",
            "I'm extremely sorry for the late notice, but I need to cancel our scheduled conference about my child's academic progress. About an hour ago, I received a call from my child's after-school program informing me that they had taken a fall during playground time and potentially injured their wrist. While the staff assured me it didn't appear to be a serious injury, they recommended that I take them to urgent care for X-rays as a precautionary measure. As any parent would understand, I immediately left work to pick them up and assess the situation myself. My child is understandably upset and in some discomfort, and I want to get them proper medical attention before the urgent care center gets too busy with the evening rush. I've rescheduled my other appointments for today so I can focus entirely on making sure they're okay and providing the comfort and attention they need right now. I would appreciate the opportunity to reschedule our conference for later this week when I can give our discussion the full attention it deserves without worrying about my child's wellbeing."
          ],
          'detailed': [
            "I need to provide a full explanation for why I was unable to attend today's important school board meeting, as I know my absence may have impacted the discussion about the proposed budget changes that could affect our children's educational programs. This morning started normally, with my usual routine of getting my two children ready for school and myself prepared for work. However, around 10 AM, I received an urgent call from my younger child's school nurse informing me that they had developed a high fever and were feeling quite unwell. The nurse was concerned enough to recommend immediate pickup rather than waiting to see if the symptoms improved throughout the day. When I arrived at school, it was clear that my child was genuinely ill – they were pale, lethargic, and running a temperature of 102°F. I immediately took them to their pediatrician, who determined that they likely had contracted a viral infection that's been circulating among children in our area. The doctor advised complete rest for at least 24-48 hours and warned that the fever could spike again, requiring close monitoring. While dealing with my sick child, I also received a call from my older child's middle school about a separate issue involving a conflict with another student that the principal felt needed parental intervention and discussion. The timing couldn't have been worse, as I was trying to juggle caring for one sick child while addressing a behavioral situation with my other child. By the time I had managed both situations, picked up prescribed medication for my younger child, and gotten everyone settled at home, it was well past the time when the school board meeting had begun. I felt it would be disruptive and disrespectful to arrive in the middle of what I knew was going to be a lengthy and important discussion about funding allocations. I want to assure you that my commitment to our children's education remains unwavering, and I will make sure to review all meeting materials and provide my input on the budget proposals through the appropriate channels."
          ]
        },
        confident: {
          'brief': [
            "Child needs attention.",
            "School emergency occurred.",
            "Parenting duty calls.",
            "Kid situation urgent.",
            "Family priority today."
          ],
          '1 sentence': [
            "I need to reschedule because my child has a medical appointment that couldn't be moved.",
            "I'll have to postpone our meeting due to an urgent school situation involving my teenager.",
            "I must cancel today's appointment to handle a childcare emergency that just arose.",
            "I need to reschedule because my child's teacher requested an immediate parent conference.",
            "I'll have to move our appointment due to a family matter that requires my immediate attention."
          ],
          '2-3 sentences': [
            "I need to reschedule our appointment because my child's school called with a disciplinary issue that requires immediate parental involvement. This type of situation takes priority over other commitments, and I need to address it before it escalates further. I can meet with you tomorrow morning if that works with your schedule.",
            "I must postpone our meeting due to a childcare emergency. My regular babysitter had a family crisis and canceled at the last minute, and I haven't been able to arrange alternative care on such short notice. As a single parent, I don't have the option to leave my child unsupervised.",
            "I need to cancel today's appointment to take my child to an urgent medical consultation. Their pediatrician wants to see them immediately about some concerning symptoms that developed overnight. Obviously, my child's health takes precedence over all other commitments."
          ],
          'paragraph': [
            "I need to inform you that I must cancel today's appointment due to a school emergency involving my child that requires my immediate presence and attention. The principal called this morning to report that my child was involved in a serious incident with another student, and school policy requires that I come in immediately for a disciplinary conference before they can return to class. As their parent, I have a responsibility to address this situation promptly and work with the school administration to understand what happened and develop an appropriate response plan. This type of issue simply cannot be postponed or handled over the phone, and I need to be physically present to advocate for my child while also ensuring they understand the consequences of their actions. I take these matters very seriously, and I believe that immediate parental involvement is crucial for resolving conflicts and preventing future incidents.",
            "I must reschedule our meeting today because I need to take my child to an emergency medical appointment that couldn't be delayed any longer. Over the past few days, they've been experiencing symptoms that initially seemed minor but have progressively worsened to the point where their pediatrician wants to see them immediately to rule out any serious underlying conditions. As any parent would understand, my child's health and wellbeing must take absolute priority over all other commitments, regardless of how important they may be. The doctor was able to fit us in this afternoon, but only if we come in immediately, and I simply cannot risk postponing medical care when it involves my child's health."
          ],
          'detailed': [
            "I am writing to inform you that I must cancel today's appointment and request rescheduling due to a serious family situation that demands my immediate and complete attention as a parent. This morning, I received an urgent call from my teenager's high school principal informing me that my child had been involved in what they described as a 'significant behavioral incident' that resulted in their suspension pending a mandatory parent-school conference and disciplinary hearing. While the principal couldn't provide all the details over the phone due to privacy policies, they made it clear that this was a serious matter that could potentially affect my child's academic standing and future enrollment status. As their parent and primary advocate, I have a legal and moral responsibility to be present for all meetings related to this incident, to understand exactly what occurred, and to work collaboratively with school administrators to develop an appropriate response that addresses both the immediate disciplinary issues and any underlying concerns that may have contributed to this behavior. This type of crisis requires my full attention and cannot be handled remotely or postponed without potentially compromising my child's educational future. Additionally, I need to coordinate with our family counselor, review the school's disciplinary policies, and possibly consult with educational advocates to ensure that my child's rights are protected throughout this process. While I understand that appointment cancellations create inconvenience and scheduling challenges, I trust that as a professional, you can appreciate that family emergencies involving children's welfare and education must take precedence over all other commitments, regardless of their importance."
          ]
        },
        humorous: {
          'brief': [
            "Tiny human rebellion.",
            "Parenting plot twist.",
            "Kid chaos erupted.",
            "Miniature disaster occurred.",
            "Small person mutiny."
          ],
          '1 sentence': [
            "I need to reschedule because my toddler has apparently formed an alliance with our dog to systematically destroy everything I own, and I'm currently playing defense in what appears to be a siege on my sanity.",
            "I'll be late because my teenager just informed me that they 'forgot' to mention they have a major project due tomorrow that requires my immediate assistance with transportation to seventeen different craft stores.",
            "I must postpone our meeting because my child decided that today was the perfect day to conduct a scientific experiment involving glitter, and my house now looks like a craft store exploded in a tornado.",
            "I need to cancel because my kid just announced that they invited their entire class over for a playdate that I apparently agreed to during a moment of parental weakness that I have no memory of.",
            "I'll have to reschedule because my child's teacher called to inform me that my offspring has been conducting what they call 'creative interpretations' of the school dress code that require immediate parental intervention."
          ],
          '2-3 sentences': [
            "I need to postpone our appointment because I'm currently dealing with what I've decided to call 'The Great Crayon Incident of 2025.' My artistic toddler discovered that crayons, when applied with sufficient enthusiasm, can be used to redecorate not just paper, but also walls, furniture, and apparently the cat. I'm now engaged in a complex negotiation involving cleaning supplies, treats, and what I hope is washable crayon technology.",
            "I'll have to reschedule our meeting because my teenager just casually mentioned that they need to be at school two hours early for the next month for some activity they signed up for and forgot to tell me about. This revelation came with the additional information that they also need a costume, seventeen different supplies, and my enthusiastic parental support for something they described as 'probably not that big of a deal.' I'm currently trying to figure out how to rearrange my entire life around this surprise commitment.",
            "I must cancel today's appointment because I'm in the middle of what my kids have dubbed 'Operation Convince Mom That Fish Don't Actually Need Water.' They've apparently been conducting secret experiments with their pet goldfish that resulted in a minor flood in their bedroom and a very confused fish who now thinks he's a land mammal. I'm currently mediating peace talks between my children and aquatic life while trying to explain the basic principles of fish biology."
          ],
          'paragraph': [
            "I need to cancel our meeting today because I'm currently managing what I can only describe as a domestic crisis orchestrated by my allegedly innocent children. This morning I discovered that my two kids had formed what appears to be a secret alliance with the goal of testing the structural integrity of our home through creative applications of various household items. The investigation began when I found our kitchen chairs arranged in an elaborate fortress configuration that somehow involved every blanket we own, three rolls of toilet paper, and what I'm pretty sure used to be my good pillows. When I asked for an explanation, they presented me with a detailed architectural plan that they had apparently been working on for weeks, complete with diagrams and a budget that assumes I'm willing to sacrifice most of our furniture for their engineering ambitions. Meanwhile, our dog has apparently been recruited as a willing accomplice and is now wearing what appears to be a cape made from my favorite tablecloth. I'm currently trying to negotiate the peaceful dismantling of Fort Living Room while also explaining why structural modifications to our house require parental approval and possibly building permits.",
            "I'll have to postpone our appointment because I'm dealing with what my family now refers to as 'The Tuesday Morning Sock Conspiracy.' It started when my youngest child announced that they could no longer wear socks because they had developed what they called 'sock sensitivity' overnight. This led to a complex investigation involving every sock in our house, during which we discovered that my older child had apparently been hoarding mismatched socks in their bedroom for what they claimed was 'an important art project.' The situation escalated when my youngest decided that if socks were optional, then shoes were probably negotiable too, and they attempted to attend school barefoot. I'm now in the middle of emergency negotiations involving sock alternatives, foot protection requirements, and what appears to be a comprehensive review of our family's footwear policies. The children have presented me with a petition signed in crayon requesting formal recognition of their right to 'sock independence,' and I'm honestly not sure how to respond to this level of organizational rebellion from people who can't remember to brush their teeth without reminders."
          ],
          'detailed': [
            "I need to cancel today's meeting because I'm currently dealing with what I have come to understand is a carefully orchestrated campaign by my children to test the absolute limits of parental patience and household physics. This morning began normally until I discovered that my two kids had apparently spent their weekend planning what they're calling 'The Great Living Room Transformation Project,' which involved relocating approximately 80% of their bedroom furniture into our common areas without consulting the adults who actually pay the mortgage. When I asked for an explanation, they produced a hand-drawn blueprint that shows our living room converted into what appears to be a combination playground, art studio, and possibly a small aircraft hangar. My youngest child, who served as the apparent project manager, explained that they had been 'optimizing our family's space utilization' and seemed genuinely surprised that I wasn't immediately impressed by their initiative. Meanwhile, my older child revealed that they had been conducting what they called 'stress tests' on various furniture items to ensure they could support the weight of their elaborate fort-building plans, which explains the concerning creaking sounds I've been hearing from upstairs. The dog, who apparently was assigned the role of 'quality control supervisor,' has been enthusiastically participating by adding his own creative touches, including what I think are teeth marks on several chair legs. I've spent the last two hours trying to negotiate the return of furniture to its original locations while also addressing their detailed presentation about why traditional room arrangements are 'inefficient' and 'limit creative expression.' They've also submitted a formal request for a family meeting to discuss what they're calling 'home improvement opportunities,' and I'm beginning to suspect that this entire operation was designed to demonstrate their readiness for increased decision-making responsibilities around the house."
          ]
        }
      },
      gamer: {
        apologetic: {
          'brief': [
            "Sorry, server crashed.",
            "Apologies, connection failed.",
            "Sorry, game emergency.",
            "Apologies, team needed.",
            "Sorry, stream issue."
          ],
          '1 sentence': [
            "I sincerely apologize for being late - my gaming session ran longer than expected when our team finally made it to the championship round.",
            "I'm deeply sorry for missing our call, but my guild was in the middle of a crucial raid that couldn't be paused or abandoned.",
            "I apologize for the delay - I was streaming a speedrun attempt and lost track of time when I got close to breaking my personal record.",
            "I'm sorry for not responding earlier, my gaming tournament match went into overtime and I couldn't step away.",
            "I deeply regret being unavailable - my team was competing in a qualifier match that determined our ranking for the season."
          ],
          '2-3 sentences': [
            "I'm extremely sorry for missing our dinner plans tonight. My esports team had an unexpected opportunity to compete in a last-minute tournament bracket, and as the team captain, I couldn't abandon them when we were so close to advancing to the next level. I should have checked my calendar more carefully before committing to the match, and I feel terrible about letting you down.",
            "I sincerely apologize for being so late to meet up with everyone. I was in the middle of what I thought would be a quick gaming session, but my team unexpectedly got matched against some really challenging opponents and the game went much longer than anticipated. I completely lost track of time and didn't realize how late it had gotten until my phone started buzzing with missed messages.",
            "I'm deeply sorry for having to cancel our plans last minute. My Twitch stream was going really well tonight and I was getting more viewers than I've ever had before, so I decided to extend it to try to hit a new subscriber milestone. I know this sounds selfish, but this kind of momentum is really rare and could help grow my channel significantly."
          ],
          'paragraph': [
            "I want to sincerely apologize for missing our group hangout tonight and explain what happened, even though I know it might sound trivial compared to other priorities. I was participating in what I thought would be a routine gaming session with my online team, but we ended up getting into an unexpectedly competitive tournament bracket that could have qualified us for a major esports competition with real prize money. As the team's strategy coordinator, I felt responsible for seeing the matches through to completion, especially since we've been working toward this opportunity for months. What I thought would be a two-hour session turned into nearly six hours of intense competition, and by the time we finished our final match, I realized I had completely missed our planned dinner and movie. I know gaming might not seem as important as real-world commitments to some people, but this team has become like a second family to me, and the potential career opportunities in competitive gaming are something I'm genuinely passionate about pursuing. I should have set better boundaries and checked in periodically, and I feel terrible that my poor time management affected our friendship plans.",
            "I'm extremely sorry for being so unreachable today, and I want to be completely honest about why I haven't been responding to messages or calls. I've been participating in a 24-hour charity gaming marathon to raise money for a children's hospital, and I committed to streaming continuously for the entire duration to maximize donations. While I planned for this event weeks in advance, I didn't properly communicate with friends and family about how unavailable I would be during this time period. The event has been incredibly successful – we've raised over $10,000 so far – but I realize that doesn't excuse the fact that I essentially disappeared without properly explaining the situation to the people in my life. I had my phone on silent and was completely focused on engaging with donors and maintaining the energy level needed for entertaining viewers for such a long period. I know this might seem like an unusual way to spend an entire day, but the cause is really important to me, and the gaming community's response has been overwhelmingly generous and supportive."
          ],
          'detailed': [
            "I need to provide a complete explanation for why I was unable to attend today's important family gathering, as I know my absence was noticed and I want to be transparent about what kept me away. For the past three months, I've been training intensively with my esports team for what turned out to be the most significant gaming tournament of my competitive career. Today was the final day of qualifications for a major international championship that could potentially offer life-changing prize money and sponsorship opportunities. Our team has been working toward this goal for over a year, practicing strategies, analyzing opponent gameplay, and building the kind of coordination that only comes from hundreds of hours of dedicated teamwork. This morning, we learned that due to some last-minute cancellations by other teams, we had been moved up in the bracket and would be competing earlier than expected, which conflicted directly with our family plans. The tournament organizers couldn't accommodate schedule changes because of live streaming commitments and international broadcast requirements, so we had to choose between forfeiting our position or missing other commitments. As the team captain and main strategist, I felt a responsibility to my teammates who have invested just as much time and effort into this opportunity as I have. We ended up advancing further than we ever have before, finishing in the top 8 out of over 200 teams worldwide, which qualified us for the next stage of competition and earned us our first significant prize money. I understand that from an outside perspective, choosing gaming over family time might seem inappropriate or immature, but this represents a genuine career opportunity in a rapidly growing industry where professional players can earn substantial income through competition, streaming, and sponsorships. I want my family to understand that this isn't just a hobby for me anymore – it's become a legitimate pursuit that I'm approaching with the same seriousness and dedication that others might apply to traditional sports or career advancement."
          ]
        },
        confident: {
          'brief': [
            "Tournament commitment today.",
            "Streaming schedule priority.",
            "Team practice required.",
            "Competition finals ongoing.",
            "Content creation deadline."
          ],
          '1 sentence': [
            "I need to reschedule because I have a tournament match that determines my team's ranking for the season.",
            "I'll have to postpone our meeting due to a scheduled streaming session with confirmed sponsors.",
            "I must cancel today's plans to participate in a championship qualifier that I've been training for.",
            "I need to reschedule because my gaming team has practice for an upcoming major competition.",
            "I'll have to move our appointment due to a content creation deadline that affects my partnership agreements."
          ],
          '2-3 sentences': [
            "I need to reschedule our meeting because I have a scheduled esports tournament that I've been preparing for over the past month. This competition determines our team's seeding for the championship bracket, and as team captain, I can't miss this crucial match. The tournament has a strict schedule that can't be adjusted for individual conflicts.",
            "I'll have to postpone our dinner plans due to a live streaming commitment with my sponsors. I have contractual obligations to maintain a specific streaming schedule, and tonight's session is particularly important because I'm launching a new content series. Missing this stream could impact my partnership agreements and revenue projections.",
            "I must cancel today's appointment to participate in a gaming marathon event that I've committed to for charity fundraising. As one of the featured streamers, I have a responsibility to the event organizers and the cause we're supporting. This type of commitment requires my full attention and participation for the entire scheduled duration."
          ],
          'paragraph': [
            "I need to inform you that I'll be unavailable for our planned meeting today due to a professional gaming commitment that takes priority in my schedule. I'm participating in the finals of a major esports tournament that my team has been working toward for the entire season, and our performance today will determine whether we advance to the international championship round. This isn't just a casual gaming session – it's a competitive event with significant prize money, potential sponsorship opportunities, and ranking implications that could affect my career prospects in the esports industry. As the team's primary strategist and shot-caller, my presence is essential for our success, and the tournament schedule is fixed due to broadcasting requirements and coordination with multiple international teams. I've spent considerable time and resources training for this opportunity, and missing it would not only let down my teammates but also potentially forfeit the progress we've made throughout the season.",
            "I must reschedule our appointment today because I have a critical streaming commitment that directly impacts my professional income and contractual obligations. I'm launching a new content series today that I've been promoting for weeks, and my sponsors are expecting specific viewer engagement numbers that determine future partnership terms. This isn't simply leisure gaming – it's a business commitment that requires my full attention and professionalism for several hours of live interaction with my audience. The streaming industry operates on very strict schedules and consistency requirements, and missing a scheduled broadcast, especially a highly promoted launch event, could damage my reputation with both viewers and business partners. I've built my career around reliable content delivery, and maintaining that reputation is essential for continued growth and financial stability."
          ],
          'detailed': [
            "I am writing to inform you that I must prioritize a significant professional gaming commitment today that conflicts with our scheduled meeting, and I want to explain the business realities that make this decision necessary. Today marks the culmination of a six-month competitive season where my esports team has the opportunity to compete in the championship finals of one of the industry's most prestigious tournaments. This event represents more than just competitive gaming – it's a legitimate business opportunity with substantial prize pools, potential sponsorship deals, and career advancement possibilities that could establish me as a recognized professional in the rapidly growing esports industry. Our team has invested hundreds of hours in strategic preparation, individual skill development, and coordinated practice sessions to reach this level of competition, and the financial investment from both personal resources and our sponsors has been considerable. Missing today's finals would not only forfeit our chance at the championship title and associated prize money, but it would also breach our agreements with sponsors who are expecting specific performance and visibility commitments in return for their financial support. The tournament schedule is non-negotiable due to international coordination requirements, live broadcast commitments to major streaming platforms, and the logistical complexity of managing multiple teams across different time zones. This is a professional obligation that I approach with the same seriousness and commitment that others might apply to traditional business meetings or career opportunities, and I trust that you can understand the importance of honoring these types of commitments in a competitive industry where reputation and reliability are essential for continued success and advancement."
          ]
        },
        humorous: {
          'brief': [
            "Controller achieved sentience.",
            "Game boss won.",
            "Pixels staged revolt.",
            "Respawn timer broken.",
            "Character trapped forever."
          ],
          '1 sentence': [
            "I'm running late because my game decided that today was the perfect day to update every single piece of software I own, turning my computer into the digital equivalent of molasses.",
            "I'll be delayed because I got stuck in what I can only describe as gaming purgatory, where every match I join has exactly one player who thinks they're directing a military operation from their mom's basement.",
            "I need to reschedule because my internet connection is apparently hosting its own personal protest against reliable service, and I'm currently getting lag spikes that make my character move like they're underwater.",
            "I'll be late because my gaming headset decided to develop what I can only call 'selective hearing' and now only works when I'm not actually trying to communicate with my team.",
            "I must postpone our meeting because I'm trapped in a game lobby with someone who insists on explaining their entire life story between rounds, and I'm too polite to leave mid-conversation."
          ],
          '2-3 sentences': [
            "I need to cancel our plans because I'm currently experiencing what I've decided to call 'The Great Gaming Equipment Rebellion of 2025.' My mouse started double-clicking randomly, my keyboard is typing letters I'm not actually pressing, and my monitor keeps flickering like it's trying to communicate in morse code. I'm beginning to suspect that my gaming setup has achieved consciousness and is now deliberately sabotaging my performance out of spite.",
            "I'll have to reschedule our dinner because I'm dealing with a technological crisis that would be hilarious if it weren't happening to me. My game crashed during what would have been my greatest victory ever, and when I tried to restart it, my computer informed me that I apparently need to update seventeen different programs before I can continue existing. Meanwhile, my teammates are probably wondering if I've been abducted by aliens or just gave up on life entirely.",
            "I must postpone our meeting because I'm currently engaged in psychological warfare with my gaming setup. My internet connection keeps cutting out at the exact moment I'm about to achieve something impressive, leading me to believe that my router has developed a sense of comedic timing. I've tried restarting everything multiple times, but my technology seems to be working together to ensure I never have a moment of gaming satisfaction."
          ],
          'paragraph': [
            "I need to cancel our plans today because I'm dealing with what I can only describe as a comedy of technological errors that would be entertaining if it weren't completely ruining my gaming session. It started this morning when I tried to join my usual gaming group, only to discover that overnight, my computer had apparently decided to install updates for programs I didn't even know I had. While waiting for those to finish, I thought I'd check my gaming headset, only to find that it had somehow unpaired itself from every device in my house and was now trying to connect to my neighbor's smart TV. When I finally got everything working, I discovered that my internet provider had chosen today to perform 'routine maintenance' that seems to involve deliberately making my connection worse than dial-up from the 1990s. My character now moves through the game world like they're swimming through peanut butter, and my teammates have started asking if I'm playing from the moon. The final straw came when my gaming chair, which I've had for three years without incident, decided that today was the perfect day for its height adjustment mechanism to break, leaving me either too low to reach my keyboard comfortably or so high that I feel like I'm commanding a spacecraft.",
            "I'll have to reschedule our movie night because I'm currently living through what my gaming friends have dubbed 'The Tuesday Gaming Disaster That Broke the Internet.' Everything started normally until I tried to download a small game update that was supposed to take five minutes but has somehow been running for three hours and is now claiming it needs to rebuild my entire computer from scratch. While that's happening, I decided to play a different game, but apparently my save file has mysteriously corrupted itself and now thinks I'm simultaneously a level 1 beginner and a level 99 master, which has confused the game's AI to the point where NPCs keep asking me to complete contradictory quests. Meanwhile, my gaming headset has developed what I can only describe as selective hearing disorder – it works perfectly for game sounds but completely cuts out whenever I try to talk to my teammates, making me sound like I'm communicating through interpretive silence. The cherry on top of this technological disaster sundae is that my mouse has apparently decided to develop its own personality and keeps clicking on things I didn't intend to click, like it's trying to play the game for me but has terrible judgment and questionable taste in character equipment."
          ],
          'detailed': [
            "I need to cancel today's plans because I am currently living through what I can only describe as the most elaborate practical joke ever orchestrated by the universe of gaming technology, and I'm starting to suspect that my equipment has formed a secret alliance against my sanity. This morning began innocently enough when I decided to start my usual gaming session, but apparently overnight, every piece of technology I own had decided to stage what I can only call a coordinated rebellion. It started when my computer informed me that it needed to install 47 critical updates before I could do anything, including several for programs I'm pretty sure I never installed and one that claims to be essential for 'optimal unicorn compatibility.' While waiting for those updates, I tried to test my gaming headset, only to discover that it had somehow forgotten how to connect to any device made after 2019 and was now only compatible with what appears to be vintage radio equipment. My gaming mouse, which has been faithful and reliable for two years, suddenly developed what I can only describe as multiple personality disorder – sometimes it clicks when I want it to, sometimes it double-clicks for fun, and occasionally it just decides to move the cursor in random circles like it's trying to hypnotize me. The situation escalated when I finally got into a game, only to find that my internet connection was apparently being routed through several third-world countries and a submarine, resulting in lag so severe that my character was responding to commands I had given approximately fifteen minutes earlier. My teammates initially thought I was performing some kind of avant-garde gaming art piece before they realized I was genuinely trapped in a time loop of delayed reactions. The final catastrophe occurred when my gaming chair, clearly feeling left out of the rebellion, decided that its height adjustment mechanism should become permanently stuck in the lowest position, leaving me sitting so close to the ground that I now need a periscope to see my monitor properly."
          ]
        }
      },
      holiday: {
        apologetic: {
          'brief': [
            "Sorry, family gathering.",
            "Apologies, holiday prep.",
            "Sorry, travel delays.",
            "Apologies, cooking crisis.",
            "Sorry, decoration disaster."
          ],
          '1 sentence': [
            "I sincerely apologize for missing our holiday party - my family's traditional dinner turned into a cooking disaster that required all hands on deck.",
            "I'm deeply sorry for being late to the celebration, but my flight was delayed three hours due to holiday travel congestion.",
            "I apologize for having to leave early - my elderly relatives needed help with their holiday preparations and I couldn't say no.",
            "I'm sorry for the last-minute cancellation, but our family's holiday plans had to be moved up unexpectedly due to a scheduling conflict.",
            "I deeply regret missing the festivities - I came down with the flu right before the holidays and didn't want to get everyone sick."
          ],
          '2-3 sentences': [
            "I'm extremely sorry for missing our holiday gathering tonight. My family's traditional dinner went completely off the rails when our turkey decided to catch fire in the oven, setting off every smoke alarm in the house and requiring a visit from the fire department. I've spent the last four hours dealing with the aftermath and trying to salvage what we could of our holiday meal.",
            "I sincerely apologize for being so late to the holiday party. I was driving to my grandmother's house to pick her up for the celebration when my car broke down on the highway, and it took over two hours for roadside assistance to arrive. By the time we got everything sorted out and made it to the party, most of the festivities were already winding down.",
            "I'm deeply sorry for having to cancel our New Year's Eve plans at the last minute. My younger cousin, who was supposed to be watching my kids, came down with a stomach bug this afternoon, and I haven't been able to find alternative childcare on such short notice. I know how much we were all looking forward to celebrating together, and I feel terrible about disappointing everyone."
          ],
          'paragraph': [
            "I want to sincerely apologize for missing today's holiday celebration and explain the family emergency that prevented my attendance. This morning, while my extended family was gathering for our traditional holiday brunch, my elderly grandfather experienced what appeared to be a minor medical episode that required immediate attention. While it turned out to be nothing serious – just a reaction to mixing his medications with too much holiday eggnog – the situation was initially quite scary and required several hours at the emergency room for observation and testing. As the only family member with medical power of attorney, I needed to be present for all the medical consultations and to coordinate with his regular physicians. By the time we got him stabilized and released with a clean bill of health, the holiday gathering had already concluded, and everyone had headed home. I know how important these holiday traditions are for maintaining family connections, especially since we only see some relatives once a year, and I'm disappointed that I missed the opportunity to catch up with everyone and participate in our usual holiday activities.",
            "I'm extremely sorry for the chaos that prevented me from attending our holiday dinner party tonight, and I want to explain what turned into a perfect storm of holiday disasters. Everything started this afternoon when I was preparing my contribution to the potluck – a family recipe that I've made successfully dozens of times before. However, today my oven apparently decided to celebrate the holidays by malfunctioning spectacularly, burning my dish beyond recognition and filling my entire house with smoke. While I was dealing with that crisis and trying to air out my kitchen, I received a frantic call from my sister saying that the restaurant where we had backup reservations for our extended family dinner had double-booked their private dining room and could no longer accommodate our large group. I spent the next two hours calling every restaurant in town trying to find alternative arrangements for fifteen people on one of the busiest dining nights of the year. Although I finally managed to secure a reservation at a place across town, the timing meant that I wouldn't be able to make it to your party and still meet my family obligations. I feel terrible about missing your celebration, especially since I was really looking forward to spending the evening with friends rather than managing family logistics."
          ],
          'detailed': [
            "I need to provide a complete explanation for why I was unable to attend today's holiday celebration, as I know how much planning and preparation went into organizing such a wonderful event for everyone. My absence was due to a series of interconnected family emergencies that began yesterday evening and continued throughout today, creating a situation that required my constant attention and presence. It started when my elderly aunt, who lives alone and had been invited to join our family's holiday gathering, fell in her apartment and was unable to get up. She managed to call me around 10 PM, and when I arrived at her place, it was clear that while she wasn't seriously injured, she had twisted her ankle badly enough that she couldn't walk safely on her own. Since she had no other local family members and was clearly frightened by the incident, I ended up staying overnight to make sure she was comfortable and to help her prepare for today's celebrations. This morning, the situation became more complicated when her regular physician recommended that she be seen at urgent care before participating in any family activities, just to rule out any more serious injury that might not have been apparent initially. The urgent care visit took much longer than expected due to holiday staffing shortages, and by the time we finished with X-rays and paperwork, it was already mid-afternoon. Although my aunt was cleared to participate in limited holiday activities, she was understandably tired and still quite shaken from her fall, so I felt it was important to stay with her through the family dinner to provide support and assistance as needed. While I was disappointed to miss your celebration, I felt that my elderly aunt needed my help and presence more than anyone else that day, and I knew that leaving her alone so soon after her accident would have made me too worried to enjoy the party anyway."
          ]
        },
        confident: {
          'brief': [
            "Family obligation today.",
            "Holiday tradition priority.",
            "Travel commitment made.",
            "Seasonal responsibility.",
            "Celebration duty calls."
          ],
          '1 sentence': [
            "I need to reschedule because I have a long-standing family holiday tradition that I can't miss.",
            "I'll have to postpone our meeting due to holiday travel commitments that were planned months ago.",
            "I must cancel today's appointment to fulfill my hosting duties for our annual holiday gathering.",
            "I need to reschedule because I'm responsible for organizing my family's holiday celebration this year.",
            "I'll have to move our appointment due to seasonal obligations that take priority during the holidays."
          ],
          '2-3 sentences': [
            "I need to reschedule our meeting because I'm hosting my family's annual holiday gathering, which involves coordinating travel arrangements for relatives coming from several different states. This is a tradition that we've maintained for over fifteen years, and as the designated organizer this year, I have responsibilities that simply can't be delegated or postponed. The timing of this event was set months ago to accommodate everyone's schedules.",
            "I must postpone our appointment due to my commitment to volunteer at the local holiday charity drive that I've been involved with for the past five years. This organization depends on regular volunteers to maintain their operations during the busy holiday season, and I've already committed specific hours that other people are counting on. Missing this volunteer shift would leave them short-staffed during one of their most critical periods.",
            "I'll have to reschedule our plans because I'm traveling to spend the holidays with elderly family members who I only see once a year. These relatives live several hours away and have limited mobility, so the holiday visit requires careful planning and a multi-day commitment. Given their age and health considerations, I can't risk postponing this visit to a later date."
          ],
          'paragraph': [
            "I need to inform you that I must prioritize a significant family obligation today that conflicts with our scheduled meeting. I'm responsible for hosting and coordinating my extended family's annual holiday reunion, which brings together relatives from across the country who only gather once a year for this celebration. This tradition has been in our family for over two decades, and this year I volunteered to take on the organizational responsibilities that include meal preparation, accommodation arrangements for out-of-town guests, and facilitating activities that help maintain family connections across multiple generations. The logistics involved in coordinating schedules for fifteen adults and children from different time zones required months of advance planning, and the timing simply cannot be adjusted without affecting travel arrangements and accommodations that have already been finalized. This gathering represents one of the most important family traditions in our calendar, and my role as host carries both practical and emotional responsibilities that I take very seriously.",
            "I must reschedule our appointment today due to my annual commitment to volunteer work that intensifies significantly during the holiday season. For the past six years, I've been a key volunteer coordinator for a local organization that provides holiday meals and gifts for families in need, and today marks one of our most critical distribution days when we serve over 300 families in our community. My role involves managing volunteer schedules, coordinating with food suppliers, and overseeing the logistics of meal preparation and distribution that requires precise timing and experienced supervision. This isn't a commitment I can delegate to others on short notice, as the organization has been counting on my specific skills and experience to ensure the event runs smoothly. The families we serve depend on this program for their holiday celebrations, and the volunteer team relies on consistent leadership to manage the complex coordination required for an operation of this scale."
          ],
          'detailed': [
            "I am writing to inform you that I must prioritize a longstanding family commitment today that requires my full attention and participation throughout the holiday celebration period. For the past twelve years, I have served as the primary organizer and host for my extended family's annual holiday reunion, which brings together relatives from six different states for what has become the most significant family gathering of our year. This tradition began when my grandparents were no longer able to travel extensively, and it has evolved into a multi-day celebration that requires months of advance planning, coordination of travel schedules for over twenty family members, and careful attention to dietary restrictions, accommodation needs, and the complex logistics of managing multiple generations in one location. My role as the designated family coordinator involves responsibilities that extend far beyond simple event planning – I serve as the central communication hub for all family members, mediate scheduling conflicts between different branches of the family, and ensure that our elderly relatives receive the assistance they need to participate fully in all activities. This year's gathering is particularly significant because it marks what will likely be my grandfather's final holiday celebration with the entire family, given his declining health and recent diagnosis. The emotional weight of this occasion, combined with the practical responsibilities I've committed to fulfilling, makes it impossible for me to divide my attention or step away from family duties during this critical time. While I understand that scheduling conflicts create inconvenience, I trust that you can appreciate the irreplaceable nature of family traditions and the importance of honoring commitments to elderly relatives who have limited remaining opportunities to celebrate with their loved ones."
          ]
        },
        humorous: {
          'brief': [
            "Turkey declared independence.",
            "Mistletoe went rogue.",
            "Presents staged revolt.",
            "Eggnog achieved sentience.",
            "Decorations mutinied."
          ],
          '1 sentence': [
            "I need to reschedule because my holiday decorations have apparently achieved consciousness and are now engaged in what I can only describe as guerrilla warfare against my attempts to create festive ambiance.",
            "I'll be late because my holiday cooking experiment has evolved into what the fire department is calling 'an interesting case study in creative kitchen disasters.'",
            "I must postpone our plans because my family's holiday gift exchange has somehow turned into a complex negotiation involving spreadsheets, treaties, and what appears to be international diplomacy.",
            "I need to cancel because I'm currently trapped in my own home by holiday decorations that have achieved strategic positioning and are now blocking all exits.",
            "I'll have to reschedule because my holiday travel plans were derailed by what I can only assume is my GPS system's impression of a festive scavenger hunt through every small town in three states."
          ],
          '2-3 sentences': [
            "I need to postpone our holiday party because I'm currently dealing with what I've decided to call 'The Great Holiday Decoration Uprising of 2025.' My attempt to create a winter wonderland in my living room has resulted in a situation where my Christmas tree appears to be plotting with the garland to take over my house. I'm now barricaded in my kitchen while string lights form what looks suspiciously like a defensive perimeter around my furniture.",
            "I'll have to reschedule our celebration because my holiday baking project has achieved what I can only describe as independent life status. What started as simple sugar cookies has evolved into a kitchen situation that requires hazmat equipment and possibly an exorcist. My oven is now making sounds that I'm pretty sure violate several laws of physics, and my cookies appear to be moving when I'm not looking directly at them.",
            "I must cancel tonight's plans because I'm currently engaged in complex diplomatic negotiations with my extended family about holiday seating arrangements. What began as a simple dinner invitation has escalated into a situation involving flow charts, assigned territories, and what appears to be a formal treaty regarding who sits where and who's responsible for bringing which dishes. I'm beginning to suspect that the United Nations could learn something from our family's approach to holiday logistics."
          ],
          'paragraph': [
            "I need to cancel our New Year's Eve plans because I'm currently dealing with what I can only describe as the most elaborate holiday disaster in recorded family history. It all started when I volunteered to host this year's celebration, thinking that how hard could it be to coordinate dinner for twelve people. However, I apparently underestimated both the complexity of holiday meal preparation and my family's ability to turn any gathering into a logistical nightmare that would challenge military strategists. First, my attempt to cook a traditional holiday roast resulted in what the smoke detector is treating as a four-alarm emergency, and I'm now pretty sure my oven has developed its own weather system. Meanwhile, my family's gift exchange evolved into something resembling international trade negotiations, complete with detailed spreadsheets tracking who bought what for whom and a complex point system that I'm convinced requires a mathematics degree to understand. The final straw came when my holiday decorations apparently formed an alliance against human habitation and have now created a maze-like obstacle course throughout my house that makes it nearly impossible to move from room to room without getting tangled in garland or attacked by wayward ornaments. I'm currently barricaded in my bathroom with my phone, a bag of emergency snacks, and what I hope is enough battery life to call for reinforcements.",
            "I'll have to reschedule our holiday celebration because I'm living through what my neighbors have started calling 'The Christmas Light Crisis That Broke Physics.' My well-intentioned attempt to create a festive display for the neighborhood has somehow resulted in a situation where my house appears to be visible from space and may be interfering with local air traffic. It started innocently enough when I decided to upgrade from my usual modest string of lights to something more elaborate, but apparently I misunderstood the electrical requirements and have now created what the power company describes as 'an interesting case study in residential energy consumption.' My electric meter is spinning so fast that I'm worried it might achieve liftoff, and my neighbors have started wearing sunglasses when they look in my direction after dark. The city inspector who came to investigate the situation said he's never seen anything quite like it and asked if I was planning to open a theme park. Meanwhile, my holiday decorations have somehow synchronized themselves into a light show that I have no idea how to control, and I'm pretty sure my reindeer lawn ornaments are now moving in formation patterns that would impress the Blue Angels."
          ],
          'detailed': [
            "I need to cancel all holiday plans because I am currently living through what I can only describe as the most spectacularly ridiculous holiday disaster that has ever befallen a human being in the history of seasonal celebrations. It began three days ago when I decided to embrace the holiday spirit by volunteering to coordinate my office's annual holiday party, thinking that my organizational skills and attention to detail would make me the perfect person for the job. However, I apparently vastly underestimated both the complexity of event planning and the capacity of holiday-themed activities to achieve independence and chaos. The first sign of trouble came when I tried to order catering for fifty people, only to discover that every restaurant in town had apparently coordinated to ensure that no two establishments offered compatible menu items, dietary accommodations, or delivery schedules. After spending an entire day creating what I can only describe as a mathematical equation involving appetizers, main courses, and desserts from seven different vendors, I thought I had everything under control. Then the decorating committee, which consists of three enthusiastic coworkers with very strong and completely contradictory opinions about holiday aesthetics, decided that our conference room needed to be transformed into what they called 'a winter wonderland that represents everyone's cultural traditions.' This resulted in a decorating scheme that combines Christmas trees, Hanukkah menorahs, Kwanzaa kinara, winter solstice symbols, and what appears to be a small shrine to hot chocolate, all arranged in a pattern that defies both logic and basic principles of interior design. The situation reached peak absurdity when our office's ancient sound system, which we were using to play holiday music, apparently became confused by the diversity of cultural celebrations and began playing what I can only describe as a mashup of traditional carols, contemporary holiday pop, and what sounds like Tibetan meditation chants, all simultaneously at different volumes. Meanwhile, the potluck portion of the party has evolved into a complex diplomatic situation where people are bringing dishes that represent their family traditions, but nobody wants to be the person who explains why their contribution doesn't technically qualify as festive or appropriate for a workplace gathering."
          ]
        }
      },
      other: {
        apologetic: {
          'brief': [
            "Sorry, unexpected issue.",
            "Apologies, urgent matter.",
            "Sorry, personal emergency.",
            "Apologies, technical problem.",
            "Sorry, scheduling conflict."
          ],
          '1 sentence': [
            "I sincerely apologize for the inconvenience - an unexpected personal matter requires my immediate attention.",
            "I'm deeply sorry for the short notice, but I'm dealing with an urgent situation that can't be postponed.",
            "I apologize for having to cancel - I'm experiencing technical difficulties that prevent me from participating properly.",
            "I'm sorry for the disruption, but a scheduling conflict has arisen that I need to resolve immediately.",
            "I deeply regret the inconvenience, but I'm handling a time-sensitive matter that takes priority."
          ],
          '2-3 sentences': [
            "I'm extremely sorry for the last-minute cancellation of our meeting. An unexpected personal emergency has arisen that requires my immediate attention and full focus. I understand this creates inconvenience for you, and I take full responsibility for the disruption.",
            "I sincerely apologize for being unable to attend today's appointment. I'm experiencing technical issues with my primary transportation that have left me stranded, and the repair timeline is uncertain. I should have had a better backup plan in place for this type of situation.",
            "I'm deeply sorry for having to reschedule our plans. A family member called with an urgent request for assistance that I simply cannot ignore or postpone. While I know this affects your schedule, I hope you can understand that family emergencies must take priority."
          ],
          'paragraph': [
            "I want to sincerely apologize for missing today's important meeting and provide an explanation for the circumstances that prevented my attendance. Early this morning, I encountered what I can only describe as a perfect storm of unfortunate events that began with a power outage in my neighborhood that knocked out my alarm clock, internet connection, and garage door opener simultaneously. When I finally woke up much later than planned, I discovered that my car's battery had died overnight, possibly due to a door that didn't close properly. While waiting for roadside assistance, I realized that my phone's battery was also critically low, and without power in my house, I had no way to charge it or contact anyone to explain my situation. By the time I managed to get everything sorted out and my various devices functioning again, I had already missed our scheduled meeting time by several hours. I take full responsibility for not having better contingency plans in place for this type of situation, and I'm committed to implementing backup systems to prevent similar problems in the future.",
            "I'm extremely sorry for the confusion and delays that have affected our scheduled appointment today, and I want to provide a complete explanation of the technical difficulties that created this situation. This morning, while preparing for our meeting, I experienced what appears to be a coordinated failure of multiple systems that I depend on for normal daily operations. My internet service provider experienced an outage that coincided with my phone's automatic software update, leaving me temporarily unable to access email, video conferencing, or reliable communication methods. When I tried to resolve the internet issue by resetting my router, I inadvertently triggered some kind of network configuration problem that made the situation worse rather than better. Meanwhile, my backup mobile data connection was severely limited due to what my carrier described as 'unexpected network congestion in your area,' which made it impossible to participate meaningfully in any online meetings or even send detailed messages about the situation. I've spent the past several hours working with technical support teams from multiple companies to restore my connectivity, but the resolution process has been much more complex and time-consuming than anyone initially anticipated."
          ],
          'detailed': [
            "I need to provide a comprehensive explanation for my absence from today's scheduled commitment, as I know how important it was and I want to be completely transparent about the circumstances that prevented my participation. This morning began with what appeared to be a minor inconvenience but quickly escalated into a series of interconnected problems that required my immediate and sustained attention throughout the day. The initial issue started when I woke up to discover that a water pipe had burst in my basement overnight, creating a situation that demanded urgent action to prevent significant property damage and potential safety hazards. The water had reached a level that threatened my electrical panel and heating system, so I immediately had to shut off the main water supply and contact emergency plumbing services to begin repairs. While waiting for the plumbers to arrive, I realized that the water damage extended to some important personal documents and electronic equipment that I needed to rescue and assess for potential replacement. The repair process became more complicated when the plumbers discovered that the pipe failure was actually symptomatic of a larger plumbing issue that required extensive excavation and repair work that couldn't be completed in a single day. As a homeowner, I felt responsible for overseeing this major repair project and coordinating with insurance representatives, contractors, and utility companies to ensure that everything was handled properly and safely. The situation required my constant presence and decision-making throughout the day, as various aspects of the repair work needed immediate approval or modification based on what the workers discovered as they progressed. While I understand that my absence created inconvenience and potentially disrupted important plans or discussions, I hope you can appreciate that this type of home emergency demanded immediate priority and couldn't be postponed without risking much more serious and expensive consequences."
          ]
        },
        confident: {
          'brief': [
            "Prior commitment today.",
            "Urgent matter arose.",
            "Scheduling conflict occurred.",
            "Priority obligation.",
            "Time-sensitive issue."
          ],
          '1 sentence': [
            "I need to reschedule due to a prior commitment that takes priority in my schedule today.",
            "I'll have to postpone our meeting because an urgent matter has arisen that requires immediate attention.",
            "I must cancel today's appointment to handle a time-sensitive issue that cannot be delayed.",
            "I need to reschedule because a scheduling conflict has developed that I must resolve.",
            "I'll have to move our appointment due to an obligation that takes precedence today."
          ],
          '2-3 sentences': [
            "I need to reschedule our meeting due to a significant personal matter that requires my immediate attention. This situation has developed unexpectedly and cannot be postponed without serious consequences. I take my commitments seriously, but this particular circumstance demands priority over other scheduled activities.",
            "I must postpone our appointment today because of an urgent professional obligation that has just been brought to my attention. The timing is unfortunate, but this matter involves time-sensitive deadlines that cannot be extended. I'm committed to rescheduling our meeting at the earliest opportunity that works for both of us.",
            "I'll have to cancel our plans due to a family responsibility that has suddenly become critical and needs immediate resolution. While I understand this creates scheduling challenges, this type of situation requires prioritization over other commitments. I'm available to reschedule for any time that accommodates your calendar."
          ],
          'paragraph': [
            "I need to inform you that I must prioritize an urgent personal matter today that conflicts with our scheduled meeting. A situation has developed that requires my immediate and sustained attention, and delaying my response could result in significantly more serious consequences that would be much more difficult to resolve later. This isn't a casual change of plans – it's a genuine priority conflict where I need to address an issue that has time-sensitive implications for important aspects of my personal or professional life. I understand that rescheduling creates inconvenience, but I'm confident that addressing this matter promptly will ultimately allow me to be more present and focused when we do meet. I'm committed to finding a replacement meeting time that works well for your schedule, and I'll make sure to block out sufficient time so that our discussion receives the attention it deserves.",
            "I must reschedule our appointment today due to an unexpected professional obligation that has emerged and requires immediate priority. This situation involves commitments and deadlines that were established before our meeting was scheduled, but the timing of the resolution process has moved up significantly due to factors beyond my control. Missing this obligation would have serious implications for ongoing projects and professional relationships that I simply cannot risk. I want to be transparent about the fact that this is a legitimate business priority rather than a casual preference, and I'm prepared to provide whatever flexibility is needed to find a suitable replacement time for our meeting. I believe in honoring commitments whenever possible, but sometimes competing priorities require difficult decisions about resource allocation and time management."
          ],
          'detailed': [
            "I am writing to inform you that I must prioritize a critical personal obligation today that requires immediate and comprehensive attention, making it necessary to reschedule our planned meeting. This situation involves a matter that I have been monitoring for some time, but recent developments have accelerated the timeline and created an urgent need for my direct involvement and decision-making. The nature of this obligation is such that delaying action beyond today would result in missed opportunities or consequences that could have lasting impact on important aspects of my personal or professional life. This isn't a decision I've made lightly – I carefully considered whether the matter could be postponed or handled remotely, but concluded that my physical presence and full attention are essential for achieving the best possible outcome. The timing is particularly unfortunate because I was genuinely looking forward to our meeting and the important discussions we had planned, but I've learned that sometimes competing priorities force difficult choices about how to allocate time and energy most effectively. I want to assure you that this rescheduling doesn't reflect any change in my commitment to our ongoing relationship or the importance I place on the matters we were going to discuss. Rather, it demonstrates my belief that addressing urgent situations promptly and thoroughly ultimately allows for better focus and engagement in all other commitments. I'm prepared to offer significant flexibility in rescheduling and will make sure to allocate adequate time for our discussion when we do meet."
          ]
        },
        humorous: {
          'brief': [
            "Reality malfunctioned today.",
            "Universe staging protest.",
            "Common sense vacation.",
            "Logic took holiday.",
            "Sanity requires maintenance."
          ],
          '1 sentence': [
            "I need to reschedule because I'm currently dealing with what I can only describe as a comprehensive failure of basic adult functionality that would be hilarious if it weren't happening to me.",
            "I'll be delayed because my day has somehow turned into an elaborate practical joke orchestrated by the universe, and I'm apparently the unwilling star of this cosmic comedy show.",
            "I must postpone our meeting because I'm experiencing what I've decided to call 'a systematic breakdown of everything that could possibly go wrong in a single morning.'",
            "I need to cancel because I'm trapped in what appears to be a real-life sitcom episode where every solution I attempt creates two new problems.",
            "I'll have to reschedule because my life has apparently decided to audition for a slapstick comedy, and I'm currently playing the role of the confused protagonist."
          ],
          '2-3 sentences': [
            "I need to postpone our appointment because I'm currently living through what I've dubbed 'The Great Tuesday Catastrophe of 2025.' Everything that could possibly malfunction in my daily routine has apparently coordinated a synchronized breakdown that began with my alarm clock and has now spread to include my coffee maker, my car, and apparently my ability to exist as a competent human being. I'm starting to suspect that this is either an elaborate test of my problem-solving skills or my house has achieved consciousness and decided to mess with me for entertainment.",
            "I'll have to reschedule our meeting because I'm dealing with what my neighbor has accurately described as 'a impressive demonstration of Murphy's Law in action.' My morning started with a series of minor inconveniences that have somehow cascaded into a situation where I'm now afraid to touch anything electronic because it immediately stops working. I'm beginning to think I've developed some kind of technological allergy that turns me into a walking EMP device.",
            "I must cancel our plans because I'm currently starring in what I can only assume is a hidden camera show called 'When Simple Tasks Attack.' Every routine activity I've attempted today has somehow evolved into a complex puzzle that requires engineering skills I don't possess and patience I definitely don't have. I'm now convinced that my house is actively working against me and possibly taking notes for future sabotage operations."
          ],
          'paragraph': [
            "I need to cancel our meeting today because I'm experiencing what I can only describe as the most entertainingly disastrous morning of my entire adult life, and I'm starting to suspect that I'm unknowingly participating in some kind of elaborate social experiment designed to test the limits of human patience and problem-solving abilities. It all started when I woke up to discover that my coffee maker had apparently achieved consciousness overnight and decided that it no longer wanted to make coffee, but rather preferred to make what I can only describe as hot brown water with the emotional depth of dishwater. While attempting to troubleshoot this caffeinated crisis, I managed to somehow trigger a chain reaction that resulted in my smoke detector deciding that the absence of actual smoke was no reason not to practice its emergency protocols at maximum volume. In my frantic attempt to silence the detector, I accidentally knocked over a plant that I didn't even know was capable of shedding this much dirt, creating what now looks like a crime scene investigation site in my kitchen. Meanwhile, my phone has apparently decided to update every single application I own at the exact moment I need to use it most, turning it into the digital equivalent of a very expensive paperweight. The final straw came when I tried to leave the house to handle some of these issues in person, only to discover that my car has developed what I can only call selective starting syndrome – it works perfectly when I'm not actually trying to go anywhere important.",
            "I'll have to reschedule our appointment because I'm currently dealing with what my family has started calling 'The Tuesday Technology Rebellion,' and I'm beginning to suspect that all of my electronic devices have formed a secret alliance against my productivity. This morning's adventure began when my laptop decided that today would be the perfect day to install what appears to be every software update that has ever been created, effectively transforming it into a very expensive space heater that occasionally displays progress bars. While waiting for that technological marathon to conclude, I tried to use my tablet, only to discover that it had somehow forgotten my password overnight and was now convinced that I was an intruder attempting to breach the security of my own device. My phone, not wanting to be left out of the rebellion, chose this moment to develop what I can only describe as selective connectivity syndrome – it can apparently access every social media platform ever invented, but refuses to connect to anything actually useful like email or maps. The situation reached peak absurdity when I attempted to make coffee using my programmable coffee maker, which had apparently reprogrammed itself to brew what I can only assume is some kind of avant-garde beverage that defies both taste and the basic principles of coffee science. I'm now sitting in my kitchen, surrounded by rebellious technology, drinking tea made with hot water from the tap, and wondering if this is how the robot uprising actually begins – not with dramatic battles, but with household appliances staging coordinated acts of passive-aggressive resistance."
          ],
          'detailed': [
            "I need to cancel today's meeting because I am currently living through what I can only describe as the most elaborate and ridiculous series of technological malfunctions that has ever befallen a single human being in the span of one morning, and I'm starting to believe that I may have accidentally offended some kind of digital deity who is now seeking revenge through coordinated electronic warfare. This morning's adventure began innocently enough when I decided to be responsible and productive by checking my email before our meeting, only to discover that my computer had apparently spent the night downloading what appears to be every software update that has ever existed since the dawn of computing. While waiting for that technological marathon to complete, I thought I'd use my phone to review our meeting materials, but my phone had mysteriously decided that it no longer recognized my fingerprint, my face, or any of the passwords that I have been using successfully for years. After forty-five minutes of increasingly creative attempts to convince my phone that I am, in fact, its rightful owner, I finally gained access only to find that every single app now requires a new terms of service agreement that apparently needs to be read and accepted individually, creating what feels like a legal document review process that could take several hours to complete. Meanwhile, my laptop finished its update marathon and promptly informed me that all of my saved passwords had been reset for security purposes, effectively locking me out of every account I need to access for work. In desperation, I tried to use my tablet as a backup device, but it had somehow synced with my phone's identity crisis and was now also refusing to recognize me as an authorized user. The situation reached peak absurdity when I attempted to call technical support using my landline, only to discover that my internet-based phone service was now completely non-functional due to what my service provider described as 'an unusual configuration error that our technicians have never seen before.' I'm now sitting in a coffee shop, using their wifi on a borrowed laptop, trying to piece together enough technological functionality to communicate with the outside world and wondering if this is how people felt during the transition from horse-drawn carriages to automobiles."
          ]
        }
      }
    };

    // Get excuses for the specified category, tone, and length
    const categoryExcuses = excuseDatabase[category] || excuseDatabase.work;
    const toneExcuses = categoryExcuses[tone] || categoryExcuses.apologetic || categoryExcuses.confident;
    const lengthExcuses = toneExcuses[length] || toneExcuses['1 sentence'] || [];

    // If no specific excuses found, use fallback
    if (lengthExcuses.length === 0) {
      const fallbacks = [
        `I need to handle an urgent ${category} situation that requires my immediate personal attention.`,
        `Due to an unexpected ${category}-related emergency, I'll need to reschedule our plans.`,
        `I'm dealing with a time-sensitive ${category} matter that simply can't wait.`
      ];
      return res.json({ excuses: [fallbacks[Math.floor(Math.random() * fallbacks.length)]] });
    }

    // Randomly select 1-3 excuses from the available options
    const numExcuses = Math.min(3, lengthExcuses.length);
    const selectedExcuses = [];
    const usedIndices = new Set();

    while (selectedExcuses.length < numExcuses && usedIndices.size < lengthExcuses.length) {
      const randomIndex = Math.floor(Math.random() * lengthExcuses.length);
      if (!usedIndices.has(randomIndex)) {
        selectedExcuses.push(lengthExcuses[randomIndex]);
        usedIndices.add(randomIndex);
      }
    }

    res.json({ excuses: selectedExcuses });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: 'Failed to generate excuses' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Excuse Engine running on port ${PORT}`);
  console.log(`📱 App URL: ${ACTUAL_BASE_URL}`);
  console.log(`\n📋 Test checkout session:`);
  console.log(`curl -X POST ${ACTUAL_BASE_URL}/api/create-checkout-session \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  --data '{"packId":"all"}'`);
  console.log(`\n🎯 Set Stripe webhook to: ${ACTUAL_BASE_URL}/api/stripe-webhook\n`);
});
