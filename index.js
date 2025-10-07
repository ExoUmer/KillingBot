const mineflayer = require('mineflayer')
require('dotenv').config()

class KillingBot {
    constructor() {
        this.bot = null
        this.intervals = {
            restart: null,
            reconnect: null
        }
        this.state = {
            isKilling: false,
            isReconnecting: false,
            isJoining: false,
            lastHeldItem: null,
            reconnectAttempts: 0
        }
        this.config = {
            host: process.env.KILLER_IP,
            port: parseInt(process.env.KILLER_PORT),
            username: process.env.KILLER_USERNAME,
            version: process.env.KILLER_VERSION,
            password: process.env.KILLER_PASSWORD,
            restartInterval: 30 * 60 * 1000,
            reconnectDelay: 10 * 1000,
            maxReconnectDelay: 120 * 1000
        }
        this.allowedCommanders = [process.env.KILLER_ALLOWED]
        this.start()
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    log(message) {
        const timestamp = new Date().toLocaleTimeString()
        console.log(`[${timestamp}][${this.config.username}] ${message}`)
    }

    cleanup() {
        this.log('🧹 Cleaning up resources...')

        Object.keys(this.intervals).forEach(key => {
            if (key !== 'reconnect' && this.intervals[key]) {
                clearInterval(this.intervals[key])
                this.intervals[key] = null
            }
        })

        this.state.isKilling = false
        this.state.isJoining = false

        if (this.bot) {
            this.bot.removeAllListeners()

            try {
                if (this.bot._client && this.bot._client.socket) {
                    this.bot.quit('Restarting...')
                }
            } catch (err) {
                // Ignore quit errors
            }

            this.bot = null
        }
    }

    getReconnectDelay() {
        const baseDelay = this.config.reconnectDelay
        const delay = Math.min(
            baseDelay * Math.pow(1.5, this.state.reconnectAttempts),
            this.config.maxReconnectDelay
        )
        return delay
    }

    async start() {
        if (this.state.isReconnecting) {
            this.log('⏳ Already reconnecting, skipping...')
            return
        }

        this.state.isReconnecting = true
        this.cleanup()

        try {
            this.log(`🚀 Starting bot... (Attempt #${this.state.reconnectAttempts + 1})`)
            this.bot = mineflayer.createBot(this.config)
            this.setupEventHandlers()
        } catch (err) {
            this.log(`❌ Failed to create bot: ${err.message}`)
            this.state.isReconnecting = false
            this.scheduleReconnect()
        }
    }

    scheduleReconnect() {
        if (this.intervals.reconnect) {
            clearInterval(this.intervals.reconnect)
            this.intervals.reconnect = null
        }

        this.state.reconnectAttempts++
        const delay = this.getReconnectDelay()

        this.log(`🔄 Scheduling reconnect in ${delay / 1000} seconds... (Attempt #${this.state.reconnectAttempts})`)
        this.cleanup()
        this.state.isReconnecting = false

        this.intervals.reconnect = setInterval(() => {
            if (!this.state.isReconnecting && !this.bot) {
                this.log('🔄 Attempting to reconnect...')
                this.start()
            }
        }, delay)

        setTimeout(() => {
            if (!this.state.isReconnecting && !this.bot) {
                this.start()
            }
        }, delay)
    }

    setupEventHandlers() {
        if (!this.bot) return

        this.bot.once('login', () => {
            this.log('🔐 Logged into server')
            this.bot.chat(`/login ${this.config.password}`)
            this.state.reconnectAttempts = 0
            this.state.isReconnecting = false

            if (this.intervals.reconnect) {
                clearInterval(this.intervals.reconnect)
                this.intervals.reconnect = null
            }
        })

        this.bot.once('spawn', async () => {
            try {
                this.log('✅ Bot spawned successfully!')
                await this.delay(1000)
                await this.loginAndJoin()
            } catch (err) {
                this.log(`❌ Spawn error: ${err.message}`)
                this.scheduleReconnect()
            }
        })

        this.bot.on('chat', (username, message) => {
            this.handleChatCommands(username, message)
        })

        this.bot.on('kicked', (reason) => {
            this.log(`❌ Bot was kicked: ${reason}`)
            this.scheduleReconnect()
        })

        this.bot.on('end', () => {
            this.log('⚠️ Bot disconnected')
            this.scheduleReconnect()
        })

        this.bot.on('error', (err) => {
            this.log(`⚠️ Bot error: ${err.message}`)
            this.state.isReconnecting = false
            this.scheduleReconnect()
        })
    }

    async loginAndJoin() {
        try {
            const window = await this.openMenu()
            await this.joinOneBlock(window)
            await this.delay(5000)

            this.startAutoRestart()
            this.startKilling()

            this.log('🎮 All systems online!')
        } catch (err) {
            this.log(`❌ Login/join error: ${err.message}`)
            this.scheduleReconnect()
        }
    }

    async openMenu(maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            this.log(`📂 Opening menu (attempt ${attempt}/${maxAttempts})`)

            const windowPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.bot.removeListener('windowOpen', onOpen)
                    reject(new Error('Menu open timeout'))
                }, 5000)

                const onOpen = (window) => {
                    clearTimeout(timeout)
                    this.bot.removeListener('windowOpen', onOpen)
                    resolve(window)
                }

                this.bot.once('windowOpen', onOpen)
            })

            try {
                this.bot.activateItem()
                const window = await windowPromise
                this.log(`📋 Window opened: ${window.title}`)
                return window
            } catch (err) {
                this.log(`⚠️ Failed to open menu on attempt ${attempt}: ${err.message}`)
                await this.delay(2000)
            }
        }

        this.log('❌ Failed to open menu after all attempts, reconnecting...')
        this.scheduleReconnect()
        throw new Error('Menu open failed')
    }

    async joinOneBlock(window) {
        return new Promise(async (resolve, reject) => {
            if (this.state.isJoining) {
                resolve(true)
                return
            }

            this.state.isJoining = true

            try {
                this.log('⏳ Joining OneBlock...')
                await this.delay(3000)
                await this.bot.clickWindow(14, 0, 0)
                this.log('📌 Clicked OneBlock slot (14)')

                let joined = false
                const timeout = setTimeout(() => {
                    if (!joined) {
                        this.bot.removeListener('message', listener)
                        reject(new Error('Join timeout'))
                    }
                }, 15000)

                const listener = (jsonMsg) => {
                    const text = jsonMsg.toString()
                    if (text.includes(`[+] ${this.config.username}`) || 
                        text.includes(`[+] [VOTER] ${this.config.username}`) || 
                        text.includes(`[+] [PRO] ${this.config.username}`) || 
                        text.includes(`[+] [LEGEND] ${this.config.username}`)) {
                        joined = true
                        clearTimeout(timeout)
                        this.bot.removeListener('message', listener)
                        this.state.isJoining = false
                        this.log('✅ Successfully joined OneBlock!')
                        resolve(true)
                    }
                }

                this.bot.on('message', listener)
            } catch (err) {
                this.state.isJoining = false
                reject(err)
            }
        })
    }

    handleChatCommands(username, message) {
        if (username === this.bot.username) return

        const cleanUser = username.trim().toLowerCase()
        const cleanMsg = message.trim().toLowerCase()

        if (!this.allowedCommanders.includes(cleanUser)) return

        this.log(`📢 Command from ${username}: ${message}`)

        switch (cleanMsg) {
            case '3':
                this.bot.chat(`/tpa ${username}`)
                this.log(`📤 Sent /tpa ${username}`)
                break
        }
    }

    async holdItem(itemName) {
        if (!this.bot || !this.bot.inventory) return false

        const name = itemName.toLowerCase().trim()
        const item = this.bot.inventory.items().find(i => i.name.includes(name))

        if (!item) {
            this.log(`❌ Item '${name}' not found in inventory!`)
            return false
        }

        try {
            await this.bot.equip(item, 'hand')
            await this.delay(200)

            if (this.bot.heldItem && this.bot.heldItem.name === item.name) {
                this.log(`✋ Equipped ${item.name}`)
                return true
            }
            return false
        } catch (err) {
            this.log(`⚠️ Failed to equip ${item.name}: ${err.message}`)
            return false
        }
    }

    async startKilling() {
        if (this.state.isKilling) {
            this.log('⚔️ Already killing mobs')
            return
        }

        this.state.isKilling = true
        const swordEquipped = await this.holdItem('sword')

        if (swordEquipped) {
            this.state.lastHeldItem = this.bot.heldItem?.name || 'sword'
            this.log(`⚔️ Started killing mobs with ${this.state.lastHeldItem}`)
        } else {
            this.log('⚠️ No sword found, starting killing anyway')
        }

        this.killingLoop()
    }

    stopKilling() {
        this.state.isKilling = false
        this.log('🛑 Stopped killing mobs')
    }

    async killingLoop() {
        while (this.state.isKilling && this.bot && !this.state.isReconnecting) {
            try {
                const target = this.bot.nearestEntity(entity => entity.type === 'mob')

                if (!target) {
                    await this.delay(100)
                    continue
                }

                const distance = this.bot.entity.position.distanceTo(target.position)

                if (distance > 6) {
                    await this.delay(100)
                    continue
                }

                // Instant rotation and attack
                this.instantLookAt(target)
                this.bot.attack(target)

                await this.delay(500)
            } catch (err) {
                this.log(`❌ Killing error: ${err.message}`)
                await this.delay(500)
            }
        }
        this.log('⚔️ Killing loop ended')
    }

    instantLookAt(target) {
        if (!this.bot || !target) return

        const targetCenter = {
            x: target.position.x,
            y: target.position.y + (target.height / 2),
            z: target.position.z
        }

        const botEye = {
            x: this.bot.entity.position.x,
            y: this.bot.entity.position.y + 1.62,
            z: this.bot.entity.position.z
        }

        const dx = targetCenter.x - botEye.x
        const dy = targetCenter.y - botEye.y
        const dz = targetCenter.z - botEye.z

        const horizontalDistance = Math.sqrt(dx * dx + dz * dz)

        const yaw = Math.atan2(-dx, -dz)
        let pitch = Math.atan2(dy, horizontalDistance)

        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch))

        this.bot.look(yaw, pitch, true)
    }

    startAutoRestart() {
        if (this.intervals.restart) clearInterval(this.intervals.restart)

        this.intervals.restart = setInterval(() => {
            this.log(`🕒 Scheduled restart (${this.config.restartInterval/ 60000} min refresh)...`)
            this.scheduleReconnect()
        }, this.config.restartInterval)
    }

    shutdown() {
        this.log('🔚 Shutting down bot...')

        Object.keys(this.intervals).forEach(key => {
            if (this.intervals[key]) {
                clearInterval(this.intervals[key])
                this.intervals[key] = null
            }
        })

        this.cleanup()
    }
}

class IdleBot {
    constructor(botNumber) {
        this.botNumber = botNumber
        this.bot = null
        this.intervals = {
            restart: null,
            reconnect: null
        }
        this.state = {
            isReconnecting: false,
            isJoining: false,
            reconnectAttempts: 0
        }
        this.config = {
            host: process.env[`IDLE${botNumber}_IP`] || process.env.KILLER_IP,
            port: parseInt(process.env[`IDLE${botNumber}_PORT`]) || parseInt(process.env.KILLER_PORT),
            username: process.env[`IDLE${botNumber}_USERNAME`] || `IdleBot${botNumber}`,
            version: process.env[`IDLE${botNumber}_VERSION`],
            password: process.env[`IDLE${botNumber}_PASSWORD`],
            restartInterval: 30 * 60 * 1000,
            reconnectDelay: 10 * 1000,
            maxReconnectDelay: 120 * 1000
        }
        this.start()
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    log(message) {
        const timestamp = new Date().toLocaleTimeString()
        console.log(`[${timestamp}][${this.config.username}] ${message}`)
    }

    cleanup() {
        this.log('🧹 Cleaning up resources...')

        Object.keys(this.intervals).forEach(key => {
            if (key !== 'reconnect' && this.intervals[key]) {
                clearInterval(this.intervals[key])
                this.intervals[key] = null
            }
        })

        this.state.isJoining = false

        if (this.bot) {
            this.bot.removeAllListeners()

            try {
                if (this.bot._client && this.bot._client.socket) {
                    this.bot.quit('Restarting...')
                }
            } catch (err) {
                // Ignore quit errors
            }

            this.bot = null
        }
    }

    getReconnectDelay() {
        const baseDelay = this.config.reconnectDelay
        const delay = Math.min(
            baseDelay * Math.pow(1.5, this.state.reconnectAttempts),
            this.config.maxReconnectDelay
        )
        return delay
    }

    async start() {
        if (this.state.isReconnecting) {
            this.log('⏳ Already reconnecting, skipping...')
            return
        }

        this.state.isReconnecting = true
        this.cleanup()

        try {
            this.log(`🚀 Starting idle bot... (Attempt #${this.state.reconnectAttempts + 1})`)
            this.bot = mineflayer.createBot(this.config)
            this.setupEventHandlers()
        } catch (err) {
            this.log(`❌ Failed to create bot: ${err.message}`)
            this.state.isReconnecting = false
            this.scheduleReconnect()
        }
    }

    scheduleReconnect() {
        if (this.intervals.reconnect) {
            clearInterval(this.intervals.reconnect)
            this.intervals.reconnect = null
        }

        this.state.reconnectAttempts++
        const delay = this.getReconnectDelay()

        this.log(`🔄 Scheduling reconnect in ${delay / 1000} seconds...`)
        this.cleanup()
        this.state.isReconnecting = false

        this.intervals.reconnect = setInterval(() => {
            if (!this.state.isReconnecting && !this.bot) {
                this.log('🔄 Attempting to reconnect...')
                this.start()
            }
        }, delay)

        setTimeout(() => {
            if (!this.state.isReconnecting && !this.bot) {
                this.start()
            }
        }, delay)
    }

    setupEventHandlers() {
        if (!this.bot) return

        this.bot.once('login', () => {
            this.log('🔐 Logged into server')
            this.bot.chat(`/login ${this.config.password}`)
            this.state.reconnectAttempts = 0
            this.state.isReconnecting = false

            if (this.intervals.reconnect) {
                clearInterval(this.intervals.reconnect)
                this.intervals.reconnect = null
            }
        })

        this.bot.once('spawn', async () => {
            try {
                this.log('✅ Bot spawned successfully!')
                await this.delay(1000)
                await this.loginAndJoin()
            } catch (err) {
                this.log(`❌ Spawn error: ${err.message}`)
                this.scheduleReconnect()
            }
        })

        this.bot.on('kicked', (reason) => {
            this.log(`❌ Bot was kicked: ${reason}`)
            this.scheduleReconnect()
        })

        this.bot.on('end', () => {
            this.log('⚠️ Bot disconnected')
            this.scheduleReconnect()
        })

        this.bot.on('error', (err) => {
            this.log(`⚠️ Bot error: ${err.message}`)
            this.state.isReconnecting = false
            this.scheduleReconnect()
        })
    }

    async loginAndJoin() {
        try {
            const window = await this.openMenu()
            await this.joinOneBlock(window)
            await this.delay(5000)

            this.startAutoRestart()
            this.log('💤 Idle bot online!')
        } catch (err) {
            this.log(`❌ Login/join error: ${err.message}`)
            this.scheduleReconnect()
        }
    }

    async openMenu(maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const windowPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.bot.removeListener('windowOpen', onOpen)
                    reject(new Error('Menu open timeout'))
                }, 5000)

                const onOpen = (window) => {
                    clearTimeout(timeout)
                    this.bot.removeListener('windowOpen', onOpen)
                    resolve(window)
                }

                this.bot.once('windowOpen', onOpen)
            })

            try {
                this.bot.activateItem()
                const window = await windowPromise
                return window
            } catch (err) {
                this.log(`⚠️ Failed to open menu on attempt ${attempt}: ${err.message}`)
                await this.delay(2000)
            }
        }

        this.log('❌ Failed to open menu after all attempts, reconnecting...')
        this.scheduleReconnect()
        throw new Error('Menu open failed')
    }

    async joinOneBlock(window) {
        return new Promise(async (resolve, reject) => {
            if (this.state.isJoining) {
                resolve(true)
                return
            }

            this.state.isJoining = true

            try {
                this.log('⏳ Joining OneBlock...')
                await this.delay(3000)
                await this.bot.clickWindow(14, 0, 0)
                this.log('📌 Clicked OneBlock slot (14)')

                let joined = false
                const timeout = setTimeout(() => {
                    if (!joined) {
                        this.bot.removeListener('message', listener)
                        reject(new Error('Join timeout'))
                    }
                }, 15000)

                const listener = (jsonMsg) => {
                    const text = jsonMsg.toString()
                    if (text.includes(`[+] ${this.config.username}`) || 
                        text.includes(`[+] [VOTER] ${this.config.username}`) || 
                        text.includes(`[+] [PRO] ${this.config.username}`) || 
                        text.includes(`[+] [LEGEND] ${this.config.username}`)) {
                        joined = true
                        clearTimeout(timeout)
                        this.bot.removeListener('message', listener)
                        this.state.isJoining = false
                        this.log('✅ Successfully joined OneBlock!')
                        resolve(true)
                    }
                }

                this.bot.on('message', listener)
            } catch (err) {
                this.state.isJoining = false
                reject(err)
            }
        })
    }

    startAutoRestart() {
        if (this.intervals.restart) clearInterval(this.intervals.restart)

        this.intervals.restart = setInterval(() => {
            this.log('🕒 Scheduled restart (30 min refresh)...')
            this.scheduleReconnect()
        }, this.config.restartInterval)
    }

    shutdown() {
        this.log('🔚 Shutting down bot...')

        Object.keys(this.intervals).forEach(key => {
            if (this.intervals[key]) {
                clearInterval(this.intervals[key])
                this.intervals[key] = null
            }
        })

        this.cleanup()
    }
}

// Initialize all bots
console.log('🎮 Starting Multi-Bot System...')
console.log('================================')

const bots = {
    killer: new KillingBot(),
    idle1: new IdleBot(1),
    idle2: new IdleBot(2),
    idle3: new IdleBot(3),
    idle4: new IdleBot(4)
}

// Store globally for shutdown handling
global.allBots = bots

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n🔚 Received SIGINT, shutting down all bots...')
    Object.values(bots).forEach(bot => bot.shutdown())
    setTimeout(() => process.exit(0), 2000)
})

process.on('SIGTERM', () => {
    console.log('\n🔚 Received SIGTERM, shutting down all bots...')
    Object.values(bots).forEach(bot => bot.shutdown())
    setTimeout(() => process.exit(0), 2000)
})

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err.message)
    console.error(err.stack)
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason)
})

console.log('✅ Multi-Bot System Started!')
console.log('- 1 Killing Bot (Active)')
console.log('- 4 Idle Bots')
console.log('================================')

module.exports = { KillingBot, IdleBot }