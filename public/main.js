// public/js/main.js

// ★★★ 匯入剛剛拆分的場景 ★★★
import LobbyScene from './lobbyscene.js';
import GameScene from './gamescene.js';

const config = {
    type: Phaser.AUTO,
    width: 1280, // 你的遊戲寬度
    height: 720, // 你的遊戲高度
    backgroundColor: '#2E8B57',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    // ★★★ 在這裡把場景放入清單，順序很重要，第一個是預設啟動的 ★★★
    scene: [LobbyScene, GameScene]
};

// 啟動遊戲
const game = new Phaser.Game(config);
