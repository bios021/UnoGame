class GameScene extends Phaser.Scene {
	constructor() { super('GameScene'); }

	init(data) {
		this.socket = data.socket;
		this.initialData = data.gameData;
		this.mySeat = data.mySeat;
	}

	create() {
		this.createDirectionTexture();
		this.createCardTextures();
		this.setupTable();

		this.createTurnIndicators();
		this.setupOpponents();

		this.createUnoButton();
		let cw = this.cameras.main.width;
		this.turnText = this.add.text(cw / 2, 50, '', {
			fontFamily: '"Microsoft JhengHei", sans-serif',
			fontSize: '24px', color: '#fff', backgroundColor: '#000000aa',
			padding: { x: 10, y: 5 }
		}).setOrigin(0.5);

		this.updateTableInfo(this.initialData);
		console.log("【遊戲開始初始狀態】");
		console.log("初始牌頂 ID:", this.currentTopCard);
		console.log("初始顏色:", this.currentTopColor);

		// --- Socket Listeners ---
		this.socket.on('updateHand', (handIds) => this.renderPlayerHand(handIds));
		this.socket.on('updateState', (data) => {
			this.updateTableInfo(data);
		});
		this.socket.on('drawOption', (data) => {
			// data.cardId 是抽到的那張牌
			this.showDrawOptionUI(data.cardId,
				// ============================================================
				// 1. 選擇「打出」的回呼 (YES)
				// ============================================================
				() => {
					const id = data.cardId;

					// ★★★ 核心修改：前端先判斷這張牌是什麼功能 (跟 renderPlayerHand 邏輯一樣) ★★★
					let actionType = "number";
					if (id >= 108) actionType = "wildDrawFour";
					else if (id >= 100) actionType = "wild";
					else {
						let val = id % 25;
						if (val >= 19 && val <= 20) actionType = "skip";
						else if (val >= 21 && val <= 22) actionType = "reverse";
						else if (val >= 23 && val <= 24) actionType = "drawTwo";
					}

					// 定義發送動作的函式
					const executePlay = (chosenColor) => {
						this.socket.emit('playerAction', {
							action: actionType, // ★ 直接傳送具體動作 (如 'skip', 'number')
							cardId: id,
							color: chosenColor
						});
					};

					// 如果是功能牌 (Wild/Wild+4)，打出前要先選色
					if (id >= 100) {
						this.showColorPicker((pickedColor) => {
							executePlay(pickedColor);
						});
					} else {
						// 一般牌直接打出 (自動計算顏色)
						let naturalColor = Math.floor(id / 25);
						executePlay(naturalColor);
					}
				},

				// ============================================================
				// 2. 選擇「保留」的回呼 (NO)
				// ============================================================
				() => {
					this.socket.emit('playerAction', {
						action: 'keepCard', // ★ 明確告訴後端：我要收下這張牌 (不出)
						cardId: data.cardId
					});
				}
			);
		});

		this.socket.on('playerShoutedUno', (data) => {
			console.log("收到 UNO 訊號！資料內容：", data); // ★ 加入這行
			this.showUnoBubble(data.seat);
			this.updateUnoStatus(data.seat, true);
		});

		this.socket.off('challengeOption');
		this.socket.on('challengeOption', (data) => {
			console.log("【前端收到挑戰訊號】", data);
			// ★★★ 修改點：使用自製 UI 取代 confirm ★★★
			this.showChallengeUI(
				data, // 如果後端有傳訊息內容，這裡可以接收
				() => { this.socket.emit('playerAction', { action: 'catch' }); },    // 抓
				() => { this.socket.emit('playerAction', { action: 'notCatch' }); }  // 不抓
			);
		});


		this.socket.on('gameOver', (data) => {
			this.time.delayedCall(500, () => {
				alert(`遊戲結束！玩家 ${data.winner + 1} 獲勝！`);
				location.reload();
			});
		});

		// 確保場景載入完成後請求手牌
		this.socket.emit('requestHand');
		this.events.on('shutdown', this.shutdown, this);
	}

	shutdown() {
		// 移除所有在此場景定義的監聽器，避免下一局重複執行
		if (this.socket) {
			this.socket.off('updateHand');
			this.socket.off('updateState');
			this.socket.off('drawOption');
			this.socket.off('challengeOption');
			this.socket.off('gameOver');
		}
	}

	/**
	 * 顯示挑戰選擇 UI
	 * @param {string} msg - 提示訊息 (例如：某某某打出了+4...)
	 * @param {Function} onCatch - 玩家選擇「抓」時的回呼
	 * @param {Function} onPass - 玩家選擇「不抓」時的回呼
	 */
	showChallengeUI(msg, onCatch, onPass) {
		const cw = this.cameras.main.width;
		const ch = this.cameras.main.height;
		const cx = cw / 2;
		const cy = ch / 2;

		// 1. 背景遮罩 (阻擋點擊)
		const blocker = this.add.rectangle(cx, cy, cw, ch, 0x000000, 0.7)
			.setInteractive();
		blocker.setDepth(1000);

		// 2. 容器
		const container = this.add.container(cx, cy);
		container.setDepth(1001);

		// 3. UI 背景板
		const panel = this.add.graphics();
		panel.fillStyle(0xFFFFFF, 1);
		panel.fillRoundedRect(-250, -150, 500, 300, 20);
		panel.lineStyle(4, 0x333333, 1);
		panel.strokeRoundedRect(-250, -150, 500, 300, 20);
		container.add(panel);

		// 4. 提示文字
		const titleText = this.add.text(0, -80, '有人出了 +4 !', {
			fontFamily: '"Titan One", sans-serif', fontSize: '42px', color: '#ff0000',
			stroke: '#000000', strokeThickness: 4
		}).setOrigin(0.5);

		const descText = this.add.text(0, -20, '你覺得他在說謊嗎？\n', {
			fontFamily: '"Noto Sans TC", sans-serif', fontSize: '24px', color: '#333333', align: 'center'
		}).setOrigin(0.5);

		container.add([titleText, descText]);

		// 5. 建立按鈕的 helper 函式
		const createBtn = (x, y, color, label, callback) => {
			const btnContainer = this.add.container(x, y);

			const btnBg = this.add.graphics();
			btnBg.fillStyle(color, 1);
			btnBg.fillRoundedRect(-80, -30, 160, 60, 15);
			btnBg.lineStyle(2, 0xffffff, 1);
			btnBg.strokeRoundedRect(-80, -30, 160, 60, 15);

			const btnText = this.add.text(0, 0, label, {
				fontFamily: '"Noto Sans TC", sans-serif', fontSize: '28px', color: '#ffffff', fontStyle: 'bold'
			}).setOrigin(0.5);

			btnContainer.add([btnBg, btnText]);

			// 設定互動區域
			const hitArea = new Phaser.Geom.Rectangle(-80, -30, 160, 60);
			btnContainer.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

			btnContainer.on('pointerover', () => this.tweens.add({ targets: btnContainer, scale: 1.1, duration: 100 }));
			btnContainer.on('pointerout', () => this.tweens.add({ targets: btnContainer, scale: 1, duration: 100 }));

			btnContainer.on('pointerdown', () => {
				this.tweens.add({
					targets: btnContainer, scale: 0.9, duration: 50, yoyo: true,
					onComplete: () => {
						// 銷毀 UI 並執行動作
						container.destroy();
						blocker.destroy();
						callback();
					}
				});
			});

			return btnContainer;
		};

		// 6. 抓 (Catch) 按鈕 - 紅色
		const btnCatch = createBtn(-100, 80, 0xff0000, '抓', onCatch);

		// 7. 不抓 (Pass) 按鈕 - 綠色
		const btnPass = createBtn(100, 80, 0x00aa00, '不抓', onPass);

		container.add([btnCatch, btnPass]);

		// 進場動畫
		container.setScale(0);
		this.tweens.add({
			targets: container,
			scale: 1,
			duration: 300,
			ease: 'Back.out'
		});
	}

	/**
	 * 顯示菱形選色盤
	 * @param {Function} onColorSelected - 回呼函式，參數為顏色ID (0:紅, 1:黃, 2:綠, 3:藍)
	 */
	showColorPicker(onColorSelected) {
		const cx = this.cameras.main.width / 2;
		const cy = this.cameras.main.height / 2;
		const size = 80; // 調整大小

		// 1. 背景遮罩 (Blocker)
		const blocker = this.add.rectangle(cx, cy, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.6)
			.setInteractive();

		// 2. 容器
		const container = this.add.container(cx, cy);

		// 顏色定義 (對應你的系統: 0:紅, 1:黃, 2:綠, 3:藍)
		// 為了排成菱形，我們將三角形旋轉
		// 紅(上, 0), 黃(右, 1), 綠(下, 2), 藍(左, 3)
		// 注意：這裡的顏色代碼要跟 createCardTextures 的順序一致
		const colors = [
			{ id: 0, color: 0xFF5555, angle: 0 },    // 紅 (上)
			{ id: 1, color: 0xFFAA00, angle: 90 },   // 黃 (右)
			{ id: 2, color: 0x55AA55, angle: 180 },  // 綠 (下)
			{ id: 3, color: 0x5555FF, angle: 270 }   // 藍 (左)
		];

		colors.forEach(data => {
			const g = this.add.graphics();
			g.fillStyle(data.color, 1);
			g.lineStyle(4, 0xffffff, 1);

			// 畫一個指向"上"的三角形，頂點在 (0,0)
			// 這樣旋轉後會拼在一起
			const trianglePath = new Phaser.Geom.Triangle(0, 0, -size, -size, size, -size);

			g.fillTriangleShape(trianglePath);
			g.strokeTriangleShape(trianglePath);

			// 設定互動
			g.setInteractive(trianglePath, Phaser.Geom.Triangle.Contains);

			g.angle = data.angle;

			g.on('pointerover', () => {
				g.alpha = 0.7;
				this.input.setDefaultCursor('pointer');
			});
			g.on('pointerout', () => {
				g.alpha = 1;
				this.input.setDefaultCursor('default');
			});

			g.on('pointerdown', () => {
				// 恢復游標
				this.input.setDefaultCursor('default');
				// 銷毀 UI
				container.destroy();
				blocker.destroy();
				// 執行回呼
				onColorSelected(data.id);
			});

			container.add(g);
		});

		// 提示文字
		const text = this.add.text(0, 0, '選色', { 
fontFamily: '"Titan One", sans-serif',
			fontSize: '32px',
			color: '#ffffff',
			stroke: '#000000', strokeThickness: 4
		}).setOrigin(0.5);
		container.add(text);

		// 動畫
		container.setScale(0);
		this.tweens.add({
			targets: container,
			scale: 1,
			duration: 300,
			ease: 'Back.out'
		});
	}

	showDrawOptionUI(cardId, onPlay, onKeep) {
		const cw = this.cameras.main.width;
		const ch = this.cameras.main.height;

		// 讓牌顯示在畫面正中央稍微偏下，比較好按
		const cx = cw / 2 - 230;
		const cy = ch / 2 + 120;

		// 1. 建立一個容器來裝「牌」跟「按鈕」
		const container = this.add.container(cx, cy);

		// 2. 顯示抽到的那張牌 (放在容器原點)
		const cardDisplay = this.createCard(0, 0, cardId);
		cardDisplay.setScale(1.2); // 稍微放大強調

		// 加上一點浮動動畫，讓它看起來像剛抽起來
		this.tweens.add({
			targets: cardDisplay,
			y: -10,
			duration: 1000,
			yoyo: true,
			repeat: -1,
			ease: 'Sine.easeInOut'
		});

		container.add(cardDisplay);

		// 3. 建立迷你按鈕的 Helper 函式
		// x, y: 相對位置
		// color: 背景色
		// icon: 按鈕文字 (例如 '✔', '✘')
		// label: 下方說明文字
		const createMiniBtn = (x, y, color, icon, labelText, callback) => {
			const btnCont = this.add.container(x, y);

			// 圓形背景
			const circle = this.add.graphics();
			circle.fillStyle(color, 1);
			circle.fillCircle(0, 0, 35); // 半徑 35
			circle.lineStyle(3, 0xffffff, 1);
			circle.strokeCircle(0, 0, 35);

			// 圖示 (打勾或打叉)
			const iconText = this.add.text(0, -5, icon, {
				fontFamily: 'Arial', fontSize: '40px', color: '#ffffff', fontStyle: 'bold'
			}).setOrigin(0.5);

			// 說明文字 (顯示在圓圈下方)
			const label = this.add.text(0, 45, labelText, {
				fontFamily: '"Noto Sans TC", sans-serif', fontSize: '18px', color: '#ffffff',
				stroke: '#000000', strokeThickness: 3
			}).setOrigin(0.5);

			btnCont.add([circle, iconText, label]);

			// 互動設定
			const hitArea = new Phaser.Geom.Circle(0, 0, 35);
			btnCont.setInteractive(hitArea, Phaser.Geom.Circle.Contains);

			btnCont.on('pointerover', () => this.tweens.add({ targets: btnCont, scale: 1.1, duration: 100 }));
			btnCont.on('pointerout', () => this.tweens.add({ targets: btnCont, scale: 1, duration: 100 }));

			btnCont.on('pointerdown', () => {
				this.tweens.add({
					targets: btnCont, scale: 0.8, duration: 50, yoyo: true,
					onComplete: () => {
						// 銷毀整個 UI 並執行回呼
						this.tweens.add({
							targets: container, alpha: 0, scale: 0, duration: 200,
							onComplete: () => {
								container.destroy();
								callback();
							}
						});
					}
				});
			});

			return btnCont;
		};

		// 4. 建立兩顆按鈕，放在牌的「左上」和「右上」

		// 打出 (綠色打勾) - 放在左上方
		const btnPlay = createMiniBtn(-80, -100, 0x00AA00, '✔', '打出', onPlay);

		// 保留 (紅色打叉) - 放在右上方
		const btnKeep = createMiniBtn(80, -100, 0xAA0000, '✘', '收下', onKeep);

		container.add([btnPlay, btnKeep]);

		// 5. 進場動畫 (從原本的牌堆位置飛出來的效果)
		container.setScale(0);
		container.y = ch; // 從下面飛上來

		this.tweens.add({
			targets: container,
			scale: 1,
			y: cy,
			duration: 400,
			ease: 'Back.out'
		});
	}

	createUnoButton() {
		let cw = this.cameras.main.width;
		let ch = this.cameras.main.height;

		// 放在手牌區右側
		const x = cw / 2 + 320;
		const y = ch - 200;

		this.unoBtn = this.add.container(x, y);

		// 1. 按鈕背景 (圓形)
		let bg = this.add.graphics();
		bg.fillStyle(0xff0000, 1); // 經典 UNO 紅
		bg.fillCircle(0, 0, 40);
		bg.lineStyle(4, 0xffffff, 1);
		bg.strokeCircle(0, 0, 40);

		// 2. 文字
		let text = this.add.text(0, 0, 'UNO', {
			fontFamily: '"Titan One", sans-serif',
			fontSize: '28px',
			color: '#ffffff'
		}).setOrigin(0.5);

		this.unoBtn.add([bg, text]);

		// 3. 互動與動畫
		let hitArea = new Phaser.Geom.Circle(0, 0, 40);
		this.unoBtn.setInteractive(hitArea, Phaser.Geom.Circle.Contains);

		this.unoBtn.on('pointerdown', () => {
			// 發送訊號給後端
			this.socket.emit('playerAction', { action: 'sayUno' });

			// 按鈕點擊動畫
			this.tweens.add({
				targets: this.unoBtn,
				scale: 0.8,
				duration: 50,
				yoyo: true
			});
		});

		// 加入呼吸燈效果 (預設暫停，剩兩張牌時啟動)
		this.unoBtnPulse = this.tweens.add({
			targets: this.unoBtn,
			scale: 1.1,
			duration: 500,
			yoyo: true,
			repeat: -1,
			paused: true
		});
		this.unoBtn.input.enabled = false;
		this.unoBtn.alpha = 0.5; // 預設也先讓它變暗
	}

	/**
	 * 更新線條旁的 UNO 狀態文字
	 * @param {number} seatIndex - 玩家座位
	 * @param {boolean} visible - true:顯示, false:隱藏
	 */
	updateUnoStatus(seatIndex, visible) {
		if (!this.unoLabels) return;

		// 計算相對位置 (0:下, 1:右, 2:上, 3:左)
		let relativeIndex = (seatIndex - this.mySeat + 4) % 4;

		// 取得對應的文字物件
		let label = this.unoLabels[relativeIndex];
		if (!label) return;

		if (visible) {
			// 如果已經顯示中，就不用重設
			if (label.visible) return;

			label.setVisible(true);
			label.setScale(1);
			label.alpha = 1;

			// 加入呼吸燈動畫 (Heartbeat)
			this.tweens.add({
				targets: label,
				scale: 1.3,
				alpha: 0.8,
				duration: 500,
				yoyo: true,
				repeat: -1
			});
		} else {
			// 隱藏並停止動畫
			label.setVisible(false);
			this.tweens.killTweensOf(label); // 停止閃爍
		}
	}

	/**
	 * 顯示某個玩家喊了 UNO 的特效
	 * @param {number} seatIndex - 喊話玩家的座位 ID
	 */
	showUnoBubble(seatIndex) {
		let cw = this.cameras.main.width;
		let ch = this.cameras.main.height;

		// 計算相對位置 (跟 updateOpponentHands 的邏輯一樣)
		// 0:自己, 1:右, 2:上, 3:左
		let relativeIndex = (seatIndex - this.mySeat + 4) % 4;

		let x, y;

		// 定義氣泡出現的位置
		if (relativeIndex === 0) { x = cw / 2; y = ch - 150; }       // 自己 (手牌上方)
		else if (relativeIndex === 1) { x = cw - 150; y = ch / 2; }  // 右邊玩家
		else if (relativeIndex === 2) { x = cw / 2; y = 150; }       // 對面玩家
		else if (relativeIndex === 3) { x = 150; y = ch / 2; }       // 左邊玩家

		// --- 製作氣泡 ---
		let container = this.add.container(x, y);

		// 爆炸底圖 (可以用 graphics 畫或是用圖片)
		let bubble = this.add.graphics();
		bubble.fillStyle(0xFFDD00, 1); // 黃色爆炸
		bubble.fillCircle(0, 0, 60);
		bubble.lineStyle(4, 0x000000, 1);
		bubble.strokeCircle(0, 0, 60);

		let text = this.add.text(0, 0, 'UNO!', {
			fontFamily: '"Titan One", sans-serif',
			fontSize: '42px',
			color: '#d60000',
			stroke: '#ffffff',
			strokeThickness: 5
		}).setOrigin(0.5);

		container.add([bubble, text]);
		container.setScale(0);
		container.depth = 100; // 確保在最上層

		// 彈出動畫
		this.tweens.add({
			targets: container,
			scale: 1.2,
			angle: Phaser.Math.Between(-20, 20), // 稍微歪一點比較生動
			duration: 400,
			ease: 'Back.out',
			onComplete: () => {
				// 停留一秒後消失
				this.tweens.add({
					targets: container,
					alpha: 0,
					y: y - 50, // 往上飄走
					duration: 500,
					delay: 1000,
					onComplete: () => container.destroy()
				});
			}
		});
	}

	updateTableInfo(data) {
		this.currentTopCard = data.topCard;   // 牌的 ID
		this.currentTopColor = data.topColor; // 當前有效顏色 (0~3)
		this.currentTurn = data.turn;         // 記錄現在輪到誰
		if (this.discardSprite) this.discardSprite.destroy();
		let cw = this.cameras.main.width;
		let ch = this.cameras.main.height;
		this.discardSprite = this.createCard(cw / 2 + 60, ch / 2, data.topCard, data.topColor);
		const colorNames = ['紅', '黃', '綠', '藍'];
		let colorName = (data.topCard > 99) ? colorNames[data.topColor] : "";
		this.updateTurnIndicators(data.turn);
		this.turnText.setText(`輪到: 玩家 ${data.turn + 1}  ${colorName ? `(顏色: ${colorName})` : ''}`);

		const bgColors = [0x552222, 0x554400, 0x225522, 0x222255];
		if (data.topColor >= 0 && data.topColor < 4) {
			this.cameras.main.setBackgroundColor(bgColors[data.topColor]);
		}

		if (this.directionSprite && data.direction) {
			if (data.direction === 1) {
				this.directionSprite.setFlipX(false);
			} else {
				this.directionSprite.setFlipX(true);
			}
		}

		if(data.players) this.updateOpponentHands(data.players);
	}

	createTurnIndicators() {
		const cw = this.cameras.main.width;
		const ch = this.cameras.main.height;
		const cx = cw / 2-300;
		const cy = ch / 2-230;

		// 設定線條參數
		const offset = 20; // 距離中心的起始距離 (避開中央的牌)
		const length = 45; // 線條長度
		const thickness = 6; // 線條粗細

		// 用來存放四個方向的線條 [下(自己), 右, 上, 左]
		// 順序很重要：0:自己, 1:右邊, 2:對面, 3:左邊 (這是相對位置)
		this.turnLines = [];
		this.unoLabels = [];

		// 定義四個方向的幾何數據
		const directions = [
			{ x: cx, y: cy + offset, w: thickness, h: length }, // 下 (自己)
			{ x: cx + offset, y: cy, w: length, h: thickness }, // 右
			{ x: cx, y: cy - offset - length, w: thickness, h: length }, // 上
			{ x: cx - offset - length, y: cy, w: length, h: thickness }  // 左
		];

		directions.forEach((dir, index) => {
			// 建立一個圖形物件
			let g = this.add.graphics();

			// 畫一條發光的線 (預設先畫成暗色)
			g.fillStyle(0xFFFFFF, 1);

			// 這裡我們畫一個圓角矩形當作線條
			// 注意：graphics 的位置是相對的，我們直接畫在絕對座標上比較簡單，或者用 container
			// 這裡直接畫在對應位置
			g.fillRoundedRect(dir.x, dir.y, dir.w, dir.h, 4);

			// 預設透明度設低一點 (暗掉的狀態)
			g.alpha = 0.8;

			this.turnLines.push(g);
			let tx = dir.x + dir.w / 2;
			let ty = dir.y + dir.h / 2;

			const textOffset = 35; // 文字距離線條多遠

			if (index === 0) ty += textOffset; // 下：文字在更下面
			if (index === 1) tx += textOffset; // 右：文字在更右邊
			if (index === 2) ty -= textOffset; // 上：文字在更上面
			if (index === 3) tx -= textOffset; // 左：文字在更左邊

			let unoText = this.add.text(tx, ty, 'UNO', {
				fontFamily: '"Titan One", sans-serif',
				fontSize: '16px',
				color: '#ff0000',     // 紅色警告色
				stroke: '#ffffff',
				strokeThickness: 3
			}).setOrigin(0.5);

			unoText.setVisible(false); // ★ 預設隱藏
			this.unoLabels.push(unoText);
		});
	}

	/**
	 * 更新回合指示線的狀態
	 * @param {number} currentTurnIndex - 目前輪到哪個座位 (0~3)
	 */
	updateTurnIndicators(currentTurnIndex) {
		if (!this.turnLines) return;

		// 計算相對位置
		// 公式：(目標座位 - 我的座位 + 4) % 4
		// 結果：0=自己(下), 1=右邊, 2=對面(上), 3=左邊
		// 假設座位順序是逆時針 0->1->2->3
		let relativeIndex = (currentTurnIndex - this.mySeat + 4) % 4;

		// 如果你的遊戲邏輯是順時針，位置 1 和 3 可能需要交換，
		// 但通常 1 號位是在你的右手邊 (下一家)。

		// 更新所有線條樣式
		//this.turnLines.forEach((line, index) => {
		//	if (index === relativeIndex) {
		// 是這個人的回合：變亮、變色
		//		line.clear();
		//		line.fillStyle(0xFFFF00, 1); // 亮黃色
		// 重新畫一次矩形 (因為 clear 掉了)
		// 由於 graphics 沒有儲存當初的 x,y,w,h，我們需要從 create 時存下來的數據重畫
		// 為了簡化，我們直接用 setTint 或 alpha 來控制比較簡單
		// 下面改用 Alpha 和 Tint 控制更高效的方法：
		//	}
		//});

		// ★★★ 優化寫法：直接調整 Alpha 和顏色 ★★★
		this.turnLines.forEach((line, index) => {
			if (index === relativeIndex) {
				line.alpha = 1; // 變全亮
				line.tint = 0xFFFF00; // 變黃色 (注意：Graphics 的 tint 支援度取決於 Phaser 版本，若無效則只靠 alpha)

				// 加入呼吸燈效果 (Tween)
				if (!line.pulseTween) {
					line.pulseTween = this.tweens.add({
						targets: line,
						alpha: 0.5,
						duration: 500,
						yoyo: true,
						repeat: -1
					});
				}
				if (line.pulseTween.isPaused()) line.pulseTween.resume();
			} else {
				line.alpha = 0.1; // 變很暗
				line.tint = 0xFFFFFF; // 變回白色
				if (line.pulseTween) {
					line.pulseTween.pause();
					line.alpha = 0.1;
				}
			}
		});
	}

	createDirectionTexture() {
		let g = this.make.graphics({ x: 0, y: 0, add: false });

		// ★ 1. 加大畫布尺寸，確保箭頭不會被切到
		const textureSize = 340;
		const center = textureSize / 2; // 中心點變成 170

		// 顏色設定
		const color = 0xffffff;
		const alpha = 0.8;

		// 箭頭參數
		const totalLength = 260;
		const barHeight = 20;
		const headLength = 50;
		const headWidth = 50;
		const gap = 260;

		g.fillStyle(color, alpha);

		// --- 1. 上方箭頭 (向左) ---
		// 使用新的 center (170) 來計算 y
		let y1 = center - gap / 2;

		g.beginPath();
		// 所有的 150 都改成 center (或者用變數 x=center)
		// 這裡直接用 center 替換原本的 150
		g.moveTo(center + totalLength / 2, y1 - barHeight / 2);
		g.lineTo(center + totalLength / 2, y1 + barHeight / 2);
		g.lineTo(center - totalLength / 2 + headLength, y1 + barHeight / 2);
		g.lineTo(center - totalLength / 2 + headLength, y1 + headWidth / 2);
		g.lineTo(center - totalLength / 2, y1);
		g.lineTo(center - totalLength / 2 + headLength, y1 - headWidth / 2);
		g.lineTo(center - totalLength / 2 + headLength, y1 - barHeight / 2);
		g.closePath();
		g.fillPath();

		// --- 2. 下方箭頭 (向右) ---
		let y2 = center + gap / 2;

		g.beginPath();
		g.moveTo(center - totalLength / 2, y2 - barHeight / 2);
		g.lineTo(center - totalLength / 2, y2 + barHeight / 2);
		g.lineTo(center + totalLength / 2 - headLength, y2 + barHeight / 2);
		g.lineTo(center + totalLength / 2 - headLength, y2 + headWidth / 2);
		g.lineTo(center + totalLength / 2, y2);
		g.lineTo(center + totalLength / 2 - headLength, y2 - headWidth / 2);
		g.lineTo(center + totalLength / 2 - headLength, y2 - barHeight / 2);
		g.closePath();
		g.fillPath();

		// ★ 2. 生成貼圖時使用新的尺寸
		g.generateTexture('direction_indicator', textureSize, textureSize);
		g.destroy();
	}

	createCardTextures() {
		const colors = [0xFF5555, 0xFFAA00, 0x55AA55, 0x5555FF, 0x333333];
		colors.forEach((color, index) => {
			let g = this.make.graphics();
			g.fillStyle(color, 1);
			g.fillRoundedRect(0, 0, 80, 120, 10);
			g.lineStyle(4, 0xFFFFFF);
			g.strokeRoundedRect(0, 0, 80, 120, 10);
			g.fillStyle(0xFFFFFF, 1);
			g.fillEllipse(40, 60, 60, 100);
			g.generateTexture(`card_bg_${index}`, 80, 120);
			g.destroy();
		});
		let g = this.make.graphics();
		g.fillStyle(0x000000, 1);
		g.fillRoundedRect(0, 0, 80, 120, 10);
		g.lineStyle(4, 0xFFFFFF);
		g.strokeRoundedRect(0, 0, 80, 120, 10);
		g.fillStyle(0xFF0000, 1);
		g.fillCircle(40, 60, 30);
		g.generateTexture('card_back', 80, 120);
		g.destroy();
	}

	setupTable() {
		let cw = this.cameras.main.width;
		let ch = this.cameras.main.height;
		this.directionSprite = this.add.sprite(cw / 2, ch / 2, 'direction_indicator');
		this.directionSprite.setAlpha(1);
		this.directionSprite.angle = -45;

		this.deckSprite = this.add.sprite(cw / 2 - 60, ch / 2, 'card_back').setInteractive();
		this.add.text(cw / 2 - 60, ch / 2 + 70, "Draw", {
			fontFamily: '"Titan One", sans-serif', fontSize: '20px', padding: { x: 5, y: 5 }
		}).setOrigin(0.5);

		this.deckSprite.on('pointerdown', () => {
			this.socket.emit('playerAction', { action: 'draw' });
			this.tweens.add({ targets: this.deckSprite, scale: 0.9, duration: 50, yoyo: true });
		});
	}

	// 修改 setupOpponents 方法
	setupOpponents() {
		// 建立一個 map 來存放對手的卡牌 Group，避免重複建立
		// key 為相對位置索引: 1(右), 2(上), 3(左)
		this.opponentCardGroups = {
			1: this.add.group(), // 右手邊
			2: this.add.group(), // 對面
			3: this.add.group()  // 左手邊
		};
	}

	renderOpponentHand(x, y, count, angle) {
		for (let i = 0; i < count; i++) {
			let offset = (i - count / 2) * 15;
			let cardX = (angle === 0) ? x + offset : x;
			let cardY = (angle === 0) ? y : y + offset;
			let card = this.add.sprite(cardX, cardY, 'card_back');
			card.angle = angle;
			card.setScale(0.8);
		}
	}

	/**
	 * 根據伺服器數據更新對手手牌
	 * @param {Array} players - 玩家列表，通常包含 [{seat:0, handCount: 7}, ...]
	 */
	updateOpponentHands(players) {
		if (!players) return;

		// 1. 先清空所有舊的對手牌
		for (let key in this.opponentCardGroups) {
			this.opponentCardGroups[key].clear(true, true); // destroyChildren = true
		}

		let cw = this.cameras.main.width;
		let ch = this.cameras.main.height;

		// 2. 遍歷所有玩家
		players.forEach(p => {
			// 跳過自己
			if (p.seat === this.mySeat) return;

			// 計算相對位置 (1:右, 2:上, 3:左)
			// 假設座位是逆時針 0->1->2->3
			let relativeIndex = (p.seat - this.mySeat + 4) % 4;

			// 取得該位置的 Group
			let group = this.opponentCardGroups[relativeIndex];
			if (!group) return;
			if (group.getLength() === p.handCount) return;

			// 設定繪製參數
			let x, y, angle;

			if (relativeIndex === 1) {
				// 右邊 (Right)
				x = cw - 80;
				y = ch / 2;
				angle = -90;
			} else if (relativeIndex === 2) {
				// 上面 (Top)
				x = cw / 2;
				y = 80;
				angle = 180; // 建議改 180 讓牌背朝向中央，原本是 0
			} else if (relativeIndex === 3) {
				// 左邊 (Left)
				x = 80;
				y = ch / 2;
				angle = 90;
			}

			// 3. 根據手牌數量 (p.handCount 或 p.handSize，看你後端怎麼傳) 繪製
			// 假設後端傳的是 handCount
			let count = p.handCount || p.cards || 0;

			// 稍微限制一下最大顯示數量，避免手牌太多時疊太長超出螢幕
			// 視覺上最多畫 15 張，超過就疊在一起
			let visualCount = count;
			let gap = 15;
			if (count > 10) gap = 10;
			if (count > 20) gap = 5;

			for (let i = 0; i < visualCount; i++) {
				let offset = (i - visualCount / 2) * gap;

				let cardX = (relativeIndex === 2) ? x + offset : x;
				let cardY = (relativeIndex === 2) ? y : y + offset;

				let card = this.add.sprite(cardX, cardY, 'card_back');
				card.angle = angle;
				card.setScale(0.6); // 對手牌可以畫小一點

				group.add(card);
			}

			// ★★★★★ 【請補上這一段】 ★★★★★
			// 如果手牌大於 1 張，代表他已經脫離 UNO 狀態，把文字關掉
			if (count > 1) {
				this.updateUnoStatus(p.seat, false);
			}
		});
	}

	renderPlayerHand(handIds) {
		let cw = this.cameras.main.width;
		let ch = this.cameras.main.height;
		let startY = ch - 80;

		if (this.playerHandGroup) this.playerHandGroup.destroy(true);
		this.playerHandGroup = this.add.group();

		const cardWidth = 80; // 卡片寬度
		const maxHandWidth = cw - 200; // 手牌區最大寬度 (螢幕寬度扣掉左右邊距各100)
		const defaultSpacing = 60; // 預設舒適間距

		let spacing = defaultSpacing;

		// 如果只有1張牌，間距沒意義；如果有2張以上，才計算
		if (handIds.length > 1) {
			// 計算如果用預設間距，總共需要多寬
			let requiredWidth = (handIds.length - 1) * defaultSpacing;

			// 如果需要的寬度 > 最大可用寬度，就縮小間距
			if (requiredWidth > maxHandWidth) {
				spacing = maxHandWidth / (handIds.length - 1);
			}
		}

		handIds.forEach((id, index) => {
			let totalWidth = (handIds.length - 1) * spacing;
			let startX = (cw / 2) - (totalWidth / 2);
			let x = startX + index * spacing;

			let cardContainer = this.createCard(x, startY, id);
			let bg = cardContainer.list[0];
			bg.setInteractive();

			bg.on('pointerover', () => {
				this.tweens.add({ targets: cardContainer, y: startY - 30, duration: 100 });
				cardContainer.depth = 100;
			});
			bg.on('pointerout', () => {
				this.tweens.add({ targets: cardContainer, y: startY, duration: 100 });
				cardContainer.depth = 0;
			});

			// ★★★ 修改點：整合選色盤邏輯 ★★★
			bg.on('pointerdown', () => {
				if (this.currentTurn !== this.mySeat) {
					console.log("還沒輪到你！");
					this.tweens.add({ targets: cardContainer, x: cardContainer.x + 5, duration: 50, yoyo: true, repeat: 3 }); // 左右搖晃特效
					return;
				}

				// 2. 檢查出牌規則
				// 取得這張手牌的資訊
				let cardId = id;
				let cardColor = Math.floor(cardId / 25); // 一般牌的顏色 (0-3)，功能牌會是 4
				let isWild = cardId >= 100;              // 是否為萬用牌

				// 取得桌面上那張牌的資訊 (從 updateTableInfo 存下來的)
				let topId = this.currentTopCard;
				let topColor = this.currentTopColor;     // 這是「當前有效顏色」(如果是萬用牌被改色，這裡會是改後的顏色)

				// ★★★ UNO 規則核心判斷 ★★★
				let canPlay = false;

				const getSymbol = (Id) => {
					let val = Id % 25;

					// 處理重複的數字牌 (10~18 對應 1~9)
					if (val >= 10 && val <= 18) return val - 9;

					// 處理功能牌的重複 ID
					if (val === 19 || val === 20) return 100; // Skip 統一回傳 100
					if (val === 21 || val === 22) return 101; // Reverse 統一回傳 101
					if (val === 23 || val === 24) return 102; // +2 統一回傳 102

					return val; // 0~9 直接回傳
				};
				let cardValue = getSymbol(cardId);
				let topValue = getSymbol(topId);

				if (isWild) {
					// 萬用牌 (Wild, Wild+4) 隨時可以出
					canPlay = true;
				} else if (cardColor === topColor) {
					// 同色可以出 (包含對上萬用牌改過的顏色)
					canPlay = true;
				}


				else if (cardValue === topValue) {
					// 同數字/同功能可以出 (例如 綠7 接 紅7，或 藍+2 接 黃+2)
					// 注意：如果桌上是 Wild (100~107)，不能單純用 %25 來接，除非是同樣的 Wild 牌(通常規則不允許Wild接Wild，視你的House Rule而定)
					// 這裡假設一般數字和功能牌判定
					if (topId < 100) {
						canPlay = true;
					}
				}

				// 3. 如果不合法，禁止出牌並搖晃卡片
				if (!canPlay) {
					console.log("這張牌不能出！");
					// 播放一個「錯誤」音效或搖晃動畫
					this.tweens.add({
						targets: cardContainer,
						angle: Phaser.Math.Between(-10, 10), // 歪一下
						duration: 50,
						yoyo: true,
						repeat: 3,
						onComplete: () => { cardContainer.angle = 0; }
					});
					return; // ★ 這裡直接 return，不執行後面的 emit
				}

				// 定義一個函式來處理「決定顏色後的動作」
				const executePlay = (chosenColor) => {
					        bg.setTexture(`card_bg_${chosenColor}`);
					let actionType = "number";
					if (id >= 108) actionType = "wildDrawFour";
					else if (id >= 100) actionType = "wild";
					else {
						let val = id % 25;
						if (val >= 19 && val <= 20) actionType = "skip";
						else if (val >= 21 && val <= 22) actionType = "reverse";
						else if (val >= 23 && val <= 24) actionType = "drawTwo";
					}

					this.socket.emit('playerAction', {
						action: actionType, cardId: id, color: chosenColor
					});
				};

				// 判斷是否需要選色
				if (id >= 100) {
					// 如果是功能牌 (Wild/Wild+4)，呼叫選色盤
					this.showColorPicker((pickedColor) => {
						// 玩家點擊顏色後，執行這裡
						executePlay(pickedColor);
					});
				} else {
					// 一般牌，顏色由牌本身決定 (0~3)
					let naturalColor = Math.floor(id / 25);
					executePlay(naturalColor);
				}
			});

			this.playerHandGroup.add(cardContainer);
		});
		if (handIds.length > 1) {
			this.updateUnoStatus(this.mySeat, false);
		}
		if (this.unoBtn && this.unoBtnPulse) {
			// UNO 規則：當你打出一張牌後剩一張時要喊 UNO
			// 所以當你手牌剩 2 張的時候，就要準備按了
			if (handIds.length === 2) {
				// 讓按鈕變亮並開始呼吸
				this.unoBtn.alpha = 1;
				if (this.unoBtn.input) this.unoBtn.input.enabled = true;
				this.unoBtnPulse.resume();    // 開始閃爍
			} else {
				// 其他張數時，暫停閃爍並變暗一點（或是隱藏）
				this.unoBtnPulse.pause();
				this.unoBtn.scale = 1; // 恢復大小
				this.unoBtn.alpha = 0.5; // 半透明表示不可用
				if (this.unoBtn.input) this.unoBtn.input.enabled = false;
			}
		}
	}

	createCard(x, y, cardId, forcedColorIndex = null) {
		let colorIndex;
		if (forcedColorIndex !== null && forcedColorIndex >= 0 && forcedColorIndex <= 3) {
			colorIndex = forcedColorIndex;
		} else {
			// 否則照舊邏輯
			colorIndex = Math.floor(cardId / 25);
			if (cardId >= 100) colorIndex = 4; // 黑牌
		}

		let textValue = "";
		if (cardId >= 108) textValue = "+4";
		else if (cardId >= 100) textValue = "W";
		else {
			let val = cardId % 25;
			if (val <= 9) textValue = val.toString(); 
else if (val <= 18) textValue = (val - 9).toString();
			else if (val <= 20) textValue = "X"; 
else if (val <= 22) textValue = "↗↙"; 
else if (val <= 24) textValue = "+2"; 
}

let container = this.add.container(x, y);
let bg = this.add.sprite(0, 0, `card_bg_${colorIndex}`);
let text = this.add.text(0, 0, textValue, {
	fontFamily: '"Titan One", "Arial Black", sans-serif',
	fontSize: '96px', color: '#FFFFFF',
	stroke: '#000000', strokeThickness: 12,
	padding: { x: 20, y: 20 }
}).setOrigin(0.5).setScale(0.35);

container.add([bg, text]);
return container;
}
}

const config = {
	type: Phaser.AUTO,
	width: 1024,
	height: 768,
	parent: 'game-container',
	backgroundColor: '#35654d',
	scene: [LobbyScene, GameScene],
	scale: {
		mode: Phaser.Scale.FIT,
		autoCenter: Phaser.Scale.CENTER_BOTH,
		//resolution: window.devicePixelRatio
	},
	render: {
		pixelArt: false, antialias: true, roundPixels: true
	}
};

const game = new Phaser.Game(config);
