const WebSocket = require('ws');
const { Telegraf } = require('telegraf')
require("dotenv").config();

const bot = new Telegraf(process.env.botToken)

const orderBook = { asks: [], bids: [] };
const pastAmountOrderBook = { asks: null, bids: null };
let sockets = {};

function compareLiquid(askPercent, bidPersent) {
    console.log(`Current Time: ${new Date().toLocaleTimeString()}`);
    
    if(!orderBook.asks.length || !orderBook.bids.length) {
        return;
    }
    
    const asksAmountSum = orderBook.asks.reduce( (acc, [, value]) => acc + parseFloat(value), 0);
    const bidsAmountSum = orderBook.bids.reduce( (acc, [, value]) => acc + parseFloat(value), 0);
    console.log(`Current ASK: ${asksAmountSum}`)
    console.log(`Current BID: ${bidsAmountSum}`)

    if(!pastAmountOrderBook.asks || !pastAmountOrderBook.bids) {
        pastAmountOrderBook.asks = asksAmountSum;
        pastAmountOrderBook.bids = bidsAmountSum;
        return;
    }
    
    const asksAmountPercent = (askPercent / 100) * pastAmountOrderBook.asks;
    const bidsAmountPercent = (bidPersent / 100) * pastAmountOrderBook.bids;
    console.log(`Percent: ${((askPercent / 100) * pastAmountOrderBook.asks)} ASK: ${pastAmountOrderBook.asks}`)
    console.log(`Percent: ${((bidPersent / 100) * pastAmountOrderBook.bids)} BID: ${pastAmountOrderBook.bids}`)
    
    console.log(`${asksAmountSum} >= ${asksAmountPercent + pastAmountOrderBook.asks}`)
    console.log(`${asksAmountSum} <= ${pastAmountOrderBook.asks - asksAmountPercent}`)
    if (asksAmountSum >= (asksAmountPercent + pastAmountOrderBook.asks)) {
        console.log(`💸 Ліквідність на купівлю виросла`)
        bot.telegram.sendMessage(process.env.chatId,"💸 Ліквідність на купівлю виросла");
    } else if (asksAmountSum <= (pastAmountOrderBook.asks - asksAmountPercent)) {
        console.log(`🚨 Ліквідність на купівлю впала`)
        bot.telegram.sendMessage(process.env.chatId,"🚨 Ліквідність на купівлю впала");
    }


    console.log(`${bidsAmountSum} >= ${bidsAmountPercent + pastAmountOrderBook.bids}`)
    console.log(`${bidsAmountSum} <= ${pastAmountOrderBook.bids - bidsAmountPercent}`)
    if(bidsAmountSum >= (bidsAmountPercent + pastAmountOrderBook.bids)) {
        console.log(`💸 Ліквідність на продаж виросла`)
        bot.telegram.sendMessage(process.env.chatId,"💸 Ліквідність на продаж виросла");
    } else if(bidsAmountSum <= (pastAmountOrderBook.bids - bidsAmountPercent)) {
        console.log(`🚨 Ліквідність на продаж впала`)
        bot.telegram.sendMessage(process.env.chatId,"🚨 Ліквідність на продаж впала");
    }
    
    pastAmountOrderBook.asks = asksAmountSum;
    pastAmountOrderBook.bids = bidsAmountSum;
}

async function addSocket({id, pair, limit, interval}, {askPersent, bidPersent}) {
    try {
        const ws = new WebSocket("wss://api.whitebit.com/ws");
        let intervalId; 

        ws.addEventListener("open", () => {
            console.log(`Start socket`)
            sockets[`${id}`] = ws;
            orderBook.asks = [];
            orderBook.bids = [];
            pastAmountOrderBook.asks = null;
            pastAmountOrderBook.bids = null;
            intervalId = setInterval(() => compareLiquid(askPersent, bidPersent), 3000);

            ws.send(
                JSON.stringify({
                    id: id,
                    method: "depth_subscribe",
                    params: [pair, limit, interval, true/*"WBT_USDT", LIMIT, "1", true*/],
                })
            );
        });

        // add on close event
        ws.addEventListener("close", () => {
            console.log(`Close socket`)
            delete sockets[`${id}`];
            clearInterval(intervalId);
            if(sockets[id]) {
                addSocket({id, pair, limit, interval}, {askPersent, bidPersent});
            }
        });

        ws.addEventListener("message", (event) => {
            try {
                const message = JSON.parse(event.data.toString());
            
                if (message.method === "depth_update") {
                    const [fullReload, updateData] = message.params;
                    const { asks, bids } = orderBook;
            
                    if (fullReload) {
                        orderBook.asks = updateData.asks ?? [];
                        orderBook.bids = updateData.bids ?? [];
                    } else {
                        applyUpdates(asks, updateData.asks, "ask");
                        applyUpdates(bids, updateData.bids, "bid");
                        truncateOrderBook(limit, asks);
                        truncateOrderBook(limit, bids);
                    }
                    
                    console.log(orderBook);
                }
            } catch (e){
                console.error(e)
            }
        });
    } catch (e){
        console.error(e)
    }
}

function applyUpdates(orderBookSide, updates, side) {
    if (!updates) return;

    for (const [price, amount] of updates) {
        const priceIndex = orderBookSide.findIndex((level) => level[0] === price);
 
        if (amount === "0") {
            if (priceIndex !== -1) {
                orderBookSide.splice(priceIndex, 1);
            }
        } else {
            if (priceIndex === -1) {
               const insertIndex = orderBookSide.findIndex((level) =>
                    side === "ask" ? level[0] > price : level[0] < price
                );
 
                if (insertIndex === -1) {
                    orderBookSide.push([price, amount]);
                } else {
                    orderBookSide.splice(insertIndex, 0, [price, amount]);
                }
            } else {
                orderBookSide[priceIndex][1] = amount;
            }
        }
    }
}

function truncateOrderBook(limit, orderBookSide) {
    if (orderBookSide.length > limit) {
        orderBookSide.splice(limit);
    }
}

bot.launch();
addSocket(
    {
        id: 1,
        pair: "WBT_USDT",
        limit: 5,
        interval: "1",
    }, 

    {
        askPersent: 0.01,
        bidPersent: 0.01,
    });

    // setTimeout(() => {
    //     const socketRemoved = sockets[`1`]
    //             delete sockets[`1`]
    //             socketRemoved.close()
    //     console.log("Interval stopped after 10 seconds.");
    //   }, 10000);
