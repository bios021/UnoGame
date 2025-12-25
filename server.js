const express=require('express');
const app=express();
const http=require('http').createServer(app);
const io=require('socket.io')(http);
const PORT=3000;

app.use(express.static('public'));

let deck = [];
let playerSockets = [null, null, null, null];
let discardPile = [];
let remainCards=112;
let players=[[], [], [], []];
let playable=false;
//let hasCalledUno = [false, false, false, false];
let status;
let color;
let topCard;
let topColor;
let currentTurnIndex;
let direction;
let isGaming=false;
let shouldTurn=false;
let shouldCatch=false;

function startGame(){
	deck=Array.from({length: 112}, (_, i) => i);
	shuffle(deck);
	players=[[], [], [], []];
	status=0;
	direction=1;

	let playerCount=0;
	for(let i=0; i<4; i++){
		if(playerSockets[i] != null){
			playerCount++;
			for(let j=0; j<7; j++){
				players[i].push(drawCard());
			}
		}
	}
	for(let i=0;i<4; i++) sortHand(i);

	do{
		if(topCard) deck.unshift(topCard);
		topCard=drawCard();
	}while(topCard>107);

	discardPile.push(topCard);
	topColor=(topCard>99)?Math.floor(Math.random()*4):Math.floor(topCard/25);
	currentTurnIndex=playerSockets.findIndex(id=>id!==null);
	isGaming=true;



	io.emit('gameStart',{
		topCard:topCard,
		topColor:topColor,
		turn:currentTurnIndex,
		players: getPlayersPublicData()
	});

	for(let i=0; i<4; i++){
		if(playerSockets[i] !== null) io.to(playerSockets[i]).emit('updateHand',players[i]);
	}
}

function getPlayersPublicData() {
	return players.map((handArray, index) => {
		return {
			seat: index,
			handCount: handArray.length
		};
	});
}

io.on('connection', (socket) => {
	socket.on('disconnect', () => {
		let seatIndex = playerSockets.indexOf(socket.id);
		if (seatIndex !== -1) {
			console.log(`玩家 ${seatIndex} 斷線`);
			playerSockets[seatIndex] = null;
			io.emit('playerLeft', { seat: seatIndex });

			if (isGaming) {
				isGaming = false;
				io.emit('errorMsg', '有人斷線，遊戲強制結束！');
			}
		}
		broadcastRoomCount();
	});
	socket.on('joinGame', () => {
		if (isGaming) {
			socket.emit('errorMsg', '遊戲已經開始了，無法加入！');
			return;
		}

		let emptySeatIndex = playerSockets.indexOf(null);
		if (emptySeatIndex !== -1) {
			playerSockets[emptySeatIndex] = socket.id;
			console.log(`玩家 ${socket.id} 入座，位置: ${emptySeatIndex}`);

			socket.emit('seatAssigned', {
				seat: emptySeatIndex,
				isHost: (emptySeatIndex === 0) //如果是第0位，他就是房主
			});

			io.emit('playerJoined', { seat: emptySeatIndex });
		} else {
			socket.emit('errorMsg', '房間滿了！');
		}
		broadcastRoomCount();
	});
	console.log('玩家連線:', socket.id);

	socket.on('requestStart',()=>{
		const playerIndex=playerSockets.indexOf(socket.id);
		if(playerIndex != 0) return;

		let count=playerSockets.filter(x=>x!==null).length;
		if(count<2) return;
		startGame();
	});
	socket.on('requestHand', () => {
		const playerIndex = playerSockets.indexOf(socket.id);
		if (playerIndex !== -1 && players[playerIndex]) {
			// 把該玩家的手牌傳回給他
			socket.emit('updateHand', players[playerIndex]);
			console.log(`玩家 ${playerIndex} 請求同步手牌`);
		}
	});
	// 當有人按下喇叭按鈕時
	socket.on('catchMissedUno', () => {
		// 取得發起檢舉的人的座位 (避免他檢舉到自己，雖然邏輯上沒差)
		let catcherSeat = playerSockets.indexOf(socket.id);
		let caughtSomeone = false; // 標記是否抓到了人

		// 遍歷所有玩家 (0 到 3)
		for (let i = 0; i < 4; i++) {
			// 跳過沒人的座位
			if (players[i].length === 0) continue;

			// 檢查條件：
			// 1. 手牌只剩 1 張
			// 2. 還沒有喊 UNO (你需要一個變數來記這個，假設叫做 playersUnoStatus[i])
			// 3. (選用) 不能抓自己

			if (players[i].length === 1 && !players[i].hasSaidUno && i !== catcherSeat) {

				// --- 抓到了！執行懲罰 ---
				console.log(`玩家 ${i} 被抓到沒喊 UNO！`);

				// 罰抽 2 張
				players[i].push(drawCard());
				players[i].push(drawCard());
				sortHand(i); // 整理手牌
				io.emit('showCatchAnim', {
					targetSeat: i,           // 被抓的人 (終點)
					catcherSeat: catcherSeat // 抓人的人 (起點) -> 新增這個
				});

				if (playerSockets[i]) {
					io.to(playerSockets[i]).emit('updateHand', players[i]);
				}
				players[i].hasSaidUno=false;
				io.emit('updateState', {
					topCard: topCard,
					topColor: topColor,
					turn: currentTurnIndex,
					lastPlayer: playerSockets.indexOf(socket.id),
					//	action: input,
					direction: direction,
					players: getPlayersPublicData()
				});
				// 廣播這件慘劇
				io.emit('errorMsg', `玩家 ${catcherSeat} 檢舉成功！玩家 ${i} 忘記喊 UNO 被罰 2 張！`);


				caughtSomeone = true;
				break; // 通常一次只抓一個，抓到就停
			}
		}

		if (!caughtSomeone) {
			// 如果掃描了一圈沒人違規
			socket.emit('errorMsg', '沒人忘記喊 UNO 喔！(別亂按)');
		}
	});


	socket.on('playerAction', (data) => {
		// data 結構範例: { action: "number", cardId: 26, color: 1 }
		if(!isGaming) return;

		const playerIndex=playerSockets.indexOf(socket.id);

		if(playerIndex === -1) return;
		if(playerIndex != currentTurnIndex) return;
		if(status == 2){
			if(data.action != 'catch' && data.action != 'notCatch') return;
		}

		if (data.action !== 'draw' && data.action !== 'catch' && data.action !== 'notCatch'&& data.action != 'sayUno' ) {

			const cardIdToCheck = data.cardId;
			const hand = players[playerIndex]; // 拿到該玩家手牌陣列

			if (!hand.includes(cardIdToCheck)) {
				console.log(`[作弊警告] 玩家 ${playerIndex} 試圖打出他沒有的牌: ${cardIdToCheck}`);
				socket.emit('errorMsg', '你手上沒有這張牌！');
				socket.emit('syncHand', hand);
				return;
			}
		}

		if (data.action === 'sayUno') {
			players[playerIndex].hasSaidUno = true;
			io.emit('playerShoutedUno', { seat: playerIndex });
			return;
		}

		let input = data.action;
		let inputNumber = data.cardId;
		let inputColor = data.color;

		console.log(`收到動作: ${input}, 卡片: ${inputNumber}`);

		shouldTurn=true;
		shouldCatch=false;
		switch(input){

			case "draw":
				status=1;
				players[currentTurnIndex].push(drawCard());
				if(isValid(players[currentTurnIndex][players[currentTurnIndex].length-1])){
					status=3;
					shouldTurn=false;
					socket.emit('drawOption', { cardId: players[currentTurnIndex][players[currentTurnIndex].length-1]})
				}
				sortHand(currentTurnIndex);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				break;
			case "playDrawnCard":
				if(data.wantToPlay){
					removeCardFromHand(currentTurnIndex,inputNumber);
					io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
					topCard=inputNumber;
					topColor=inputColor;
				}
				status=1;
				break;
			case "keepCard":
				status=1;
				break;
			case "number":
				status=1;
				removeCardFromHand(currentTurnIndex,inputNumber);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				topCard=inputNumber;
				topColor=inputColor;
				break;
			case "reverse":
				status=1;
				removeCardFromHand(currentTurnIndex,inputNumber);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				direction=-direction;
				topCard=inputNumber;
				topColor=inputColor;
				break;
			case "skip":
				status=1;
				removeCardFromHand(currentTurnIndex,inputNumber);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				topColor=inputColor;
				topCard=inputNumber;
				nextTurn();
				break;
			case "drawTwo":
				removeCardFromHand(currentTurnIndex,inputNumber);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				topCard=inputNumber;
				topColor=inputColor;
				nextTurn();
				for(let i=0; i<2; i++) players[currentTurnIndex].push(drawCard());
				sortHand(currentTurnIndex);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				status=1;
				break;
			case "wild":
				removeCardFromHand(currentTurnIndex,inputNumber);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				topCard=inputNumber;
				topColor=inputColor;
				status=1;
				break;
			case "wildDrawFour":
				removeCardFromHand(currentTurnIndex,inputNumber);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				topCard=inputNumber;
				status=2;
				topColor=inputColor;
				shouldCatch=true;
				break;
			case "notCatch":
				for(let i=0; i<4; i++) players[currentTurnIndex].push(drawCard());
				console.log("排序前的手牌:", players[currentTurnIndex]);

				sortHand(currentTurnIndex);

				// ★★★ 加入這行除錯 ★★★
				console.log("排序後的手牌:", players[currentTurnIndex]);
				io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				status=1;
				break;
			case "catch":
				lastTurn();

				let lastTop = -1;
				let lastColor = -1;

				if(discardPile.length >= 2) {
					lastTop = discardPile[discardPile.length - 2];
					lastColor = Math.floor(lastTop / 25);
				} else {
					lastColor = topColor; 
					lastTop = -1; 
				}
				if(hasPlayableNormalCard(currentTurnIndex, lastTop, lastColor)){
					for(let i=0; i<4; i++) players[currentTurnIndex].push(drawCard());
					sortHand(currentTurnIndex);
					io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				}
				else{
					nextTurn();
					for(let i=0; i<6; i++) players[currentTurnIndex].push(drawCard());
					sortHand(currentTurnIndex);
					io.to(playerSockets[currentTurnIndex]).emit('updateHand', players[currentTurnIndex]);
				}
				status=1;
				break;
		}
		if(players[playerIndex].length === 0){
			isGaming=false;
			//io.emit('gameOver', { winner: playerIndex });
			// 1. 計算所有人的分數與資訊
			let results = [];
			for(let i=0; i<4; i++) {
				// 如果該座位有人
				if (playerSockets[i] !== null) {
					results.push({
						seat: i,
						isWinner: (i === playerIndex), // 是不是贏家
						handCount: players[i].length,  // 剩幾張
						score: calculateHandScore(players[i]) // 罰分 (贏家是0)
					});
				}
			}

			// 2. 排序排名 (分數越低越好，贏家分數是 0 排第一)
			results.sort((a, b) => a.score - b.score);

			// 3. 廣播詳細結果給所有人
			io.emit('gameOver', {
				winnerSeat: playerIndex,
				results: results
			});
		}

		if(shouldTurn) nextTurn();
		const playersPublicData = players.map((handArray, index) => {
			return {
				seat: index,           // 0, 1, 2, 3
				handCount: handArray.length // 直接取陣列長度
			};
		});
		if (players[playerIndex].length !== 1) {
			players[playerIndex].hasSaidUno = false;
		}

		io.emit('updateState', {
			topCard: topCard,
			topColor: topColor,
			turn: currentTurnIndex,
			lastPlayer: playerIndex,
			//action: input,
			direction: direction,
			players: getPlayersPublicData()
		});
		if(shouldCatch) io.to(playerSockets[currentTurnIndex]).emit('challengeOption',{});

	});
});

function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}



function isValid(i){
	let topValue=(topCard>99)?-1:topCard%25;
	let cardValue=i%25;
	let cardColor=Math.floor(i/25);


	if(i>99) return true;
	else if(cardColor == topColor) return true;
	const getSymbol = (id) => {
		//if (id >= 100) return -1; // Wild 不參與數值比對
		let val = id;

		// 處理重複的數字牌 (10~18 對應 1~9)
		if (val >= 10 && val <= 18) return val - 9;

		// 處理功能牌的重複 ID
		if (val === 19 || val === 20) return 100; // Skip 統一回傳 100
		if (val === 21 || val === 22) return 101; // Reverse 統一回傳 101
		if (val === 23 || val === 24) return 102; // +2 統一回傳 102

		return val; // 0~9 直接回傳
	};

	let mySymbol = getSymbol(i);
	let topSymbol = getSymbol(topValue);

	// 3. 如果符號一樣 (例如都是 Skip，或是都是數字 5)，就可以出
	if (mySymbol === topSymbol) return true;

	return false;
}

function drawCard() {
	if (deck.length === 0) {
		if (discardPile.length > 0) {
			let lastCard=discardPile.pop();
			deck = discardPile;
			discardPile = [lastCard];
			shuffle(deck);
		} else {
			return null; 
		}
	}
	return deck.pop(); 
}

function removeCardFromHand(playerIndex, cardIdToRemove) {
	let hand = players[playerIndex];
	let index = hand.indexOf(cardIdToRemove);

	if (index !== -1) {
		discardPile.push(cardIdToRemove);
		hand.splice(index, 1);
	}
}

function hasPlayableNormalCard(index, topCard, currentColor) {
	let hand=players[index];
	let topValue = (topCard>99) ? -1 : (topCard%25);

	return hand.some(cardId => {
		if(cardId>99) return false;

		let cardColor=Math.floor(cardId/25);
		let cardValue=cardId%25;

		if(cardColor == currentColor) return true;
		else if(cardValue == topValue) return true;		
	});
}

function sortHand(playerIndex) {
	players[playerIndex].sort((a, b) => {
		// 1. 首先比較顏色 (每 25 張一個顏色區塊)
		// 假設 100 以上是功能牌(黑牌)，視為第 5 種顏色
		let colorA = (a >= 100) ? 999 : Math.floor(a / 25);
		let colorB = (b >= 100) ? 999 : Math.floor(b / 25);

		// 如果顏色不同，直接把不同顏色的分開
		if (colorA !== colorB) {
			return colorA - colorB;
		}

		// 2. 如果顏色相同，比較「邏輯數值」
		let valA = getLogicValue(a);
		let valB = getLogicValue(b);

		return valA - valB;
	});
}

function getLogicValue(cardId) {
	if (cardId >= 100) return cardId;

	let raw = cardId % 25;

	if (raw >= 10 && raw <= 18) {
		return raw - 9;
	}

	// 其他情況 (0-9, 19-24) 保持原值
	return raw;
}

function nextTurn(){
	let count=0;
	do{
		count++;
		currentTurnIndex=((currentTurnIndex+direction)%4+4)%4;			
	}while(playerSockets[currentTurnIndex] === null&&count<4);
}


function lastTurn(){
	currentTurnIndex=((currentTurnIndex-direction)%4+4)%4;
}

function broadcastRoomCount() {
    // 計算目前非 null 的玩家數量
    let count = playerSockets.filter(x => x !== null).length;
    // 發送給所有人
    io.emit('updateRoomCount', { count: count });
}

// server.js 最下方

// UNO 計分規則：
// 數字牌 (0-9)：面額
// 功能牌 (Skip, Reverse, Draw2)：20分
// 王牌 (Wild, Wild4)：50分
function calculateHandScore(hand) {
	let score = 0;
	for (let cardId of hand) {
		if (cardId >= 100) {
			// Wild (100+) & Wild Draw 4
			score += 50; 
		} else {
			let val = cardId % 25;
			// 0-9 (注意：10-18 也是數字牌 1-9)
			if (val <= 9) score += val;
			else if (val >= 10 && val <= 18) score += (val - 9);
			// 19-24 是功能牌 (+2, 禁止, 迴轉)
			else score += 20; 
		}
	}
	return score;
}

http.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
