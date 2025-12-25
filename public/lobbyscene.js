export default class LobbyScene extends Phaser.Scene {
    constructor() {
        super('LobbyScene');
    }

    preload() {
        this.load.script('webfont', 'https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js');
    }

    create() {
        this.socket = io();
        this.currentStatusStr = '正在連線...';
        // 預設人數文字
        this.currentCountStr = '目前人數: - / 4'; 
        this.uiReady = false;

        WebFont.load({
            google: {
                families: ['Titan One', 'Noto Sans TC', 'Saira:300']
            },
            active: () => this.createLobbyUI(),
            inactive: () => this.createLobbyUI()
        });

        this.socket.emit('joinGame');

        this.socket.on('seatAssigned', (data) => {
            this.currentStatusStr = `已入座 (位置 ${data.seat + 1})\n等待其他玩家...`;
            if (this.statusText) this.statusText.setText(this.currentStatusStr);

            this.mySeat = data.seat;
            if (data.isHost) {
                this.isHost = true;
                if (this.uiReady) this.createStartButton();
            }
        });

        // ▼▼▼ 新增：監聽人數更新 ▼▼▼
        this.socket.on('updateRoomCount', (data) => {
            this.currentCountStr = `目前人數: ${data.count} / 4`;
            // 如果 UI 已經畫好了，就更新文字
            if (this.countText) {
                this.countText.setText(this.currentCountStr);
            }
        });
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        this.socket.on('errorMsg', (msg) => {
            this.currentStatusStr = msg;
            if (this.statusText) {
                this.statusText.setText(msg);
                this.statusText.setColor('#ff5555');
            }
        });

        this.socket.on('playerJoined', (data) => console.log(`玩家 ${data.seat} 加入`));

        this.socket.on('gameStart', (initialData) => {
            this.scene.start('GameScene', {
                socket: this.socket,
                gameData: initialData,
                mySeat: this.mySeat
            });
        });
    }

    createLobbyUI() {
        this.uiReady = true;
        let cw = this.cameras.main.width;
        let ch = this.cameras.main.height;

        this.add.text(cw / 2, ch / 3, 'Node UNO', {
            fontFamily: '"Titan One", sans-serif',
            fontSize: '80px',
            color: '#ffffff',
            stroke: '#000000', strokeThickness: 6,
            padding: { x: 20, y: 20 }
        }).setOrigin(0.5);

        this.statusText = this.add.text(cw / 2, ch / 2, this.currentStatusStr, {
            fontFamily: '"Microsoft JhengHei", "Noto Sans TC", sans-serif',
            fontSize: '32px',
            color: '#aaaaaa',
            align: 'center', // 讓多行文字置中
            padding: { x: 20, y: 20 }
        }).setOrigin(0.5);

        // ▼▼▼ 新增：顯示人數的文字 (放在狀態文字下面) ▼▼▼
        this.countText = this.add.text(cw / 2, ch / 2 + 80, this.currentCountStr, {
            fontFamily: '"Saira", "Microsoft JhengHei", sans-serif',
            fontSize: '28px',
            color: '#ffd700', // 金色字體比較顯眼
            fontStyle: 'bold'
        }).setOrigin(0.5);
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        if (this.isHost) this.createStartButton();
    }

    createStartButton() {
        if (this.startBtn) return;
        let cw = this.cameras.main.width;
        let ch = this.cameras.main.height;
        let x = cw / 2;
        // 把按鈕位置稍微往下移一點，避免擋到人數文字
        let y = ch / 2 + 180; 

        // 按鈕參數
        const rectWidth = 160;
        const height = 70;
        const tipLength = 40;
        const halfRW = rectWidth / 2;
        const halfH = height / 2;

        this.startBtn = this.add.container(x, y);

        let bg = this.add.graphics();
        bg.fillStyle(0x00aa00, 1);

        bg.beginPath();
        bg.moveTo(-halfRW - tipLength, 0);
        bg.lineTo(-halfRW, -halfH);
        bg.lineTo(halfRW, -halfH);
        bg.lineTo(halfRW + tipLength, 0);
        bg.lineTo(halfRW, halfH);
        bg.lineTo(-halfRW, halfH);
        bg.closePath();
        bg.fillPath();

        let text = this.add.text(0, 0, ' START ', {
            fontFamily: '"Saira", sans-serif',
            fontWeight: '300',
            fontSize: '32px',
            color: '#ffffff',
            shadow: { offsetX: 1, offsetY: 1, color: 'rgba(0,0,0,0.3)', blur: 2, fill: true }
        }).setOrigin(0.5);

        this.startBtn.add([bg, text]);

        // 設定點擊區域
        const hitAreaPolygon = new Phaser.Geom.Polygon([
            new Phaser.Math.Vector2(-halfRW - tipLength, 0),
            new Phaser.Math.Vector2(-halfRW, -halfH),
            new Phaser.Math.Vector2(halfRW, -halfH),
            new Phaser.Math.Vector2(halfRW + tipLength, 0),
            new Phaser.Math.Vector2(halfRW, halfH),
            new Phaser.Math.Vector2(-halfRW, halfH)
        ]);

        this.startBtn.setInteractive(hitAreaPolygon, Phaser.Geom.Polygon.Contains);

        this.startBtn.on('pointerdown', () => {
            this.socket.emit('requestStart');
            this.tweens.add({ targets: this.startBtn, scale: 0.9, duration: 50, yoyo: true });
        });

        this.startBtn.on('pointerover', () => {
            this.tweens.add({ targets: this.startBtn, scale: 1.05, duration: 100 });
        });

        this.startBtn.on('pointerout', () => {
            this.tweens.add({ targets: this.startBtn, scale: 1, duration: 100 });
        });
    }
}
