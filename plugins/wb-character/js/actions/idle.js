export default {
    id: 'idle',
    label: '待机 (Idle)',
    category: 'basic',
    defaultFrameCount: 5,
    looping: true,
    skipReferenceFrame: true,

    prompt: {
        motion: 'idle breathing loop: the character stands perfectly still in place, with only subtle chest rise/fall breathing and very slight body sway. Arms hang naturally. The pose is relaxed and calm.',
        groundRule: 'strict',
        extraRules: [
            'Movement must be EXTREMELY subtle — only breathing and micro-sway. This is the most minimal animation possible.',
            'The character must NOT shift left or right AT ALL. Keep horizontal center-of-mass perfectly fixed across all frames.',
            'Arms, legs, and feet should remain essentially static. Only the torso breathes slightly.',
            'The weapon (if any) is HELD PERFECTLY STILL — NO movement, NO swinging, NO repositioning between frames.',
            'The character silhouette must remain nearly identical across all frames — only the chest area rises/falls subtly.'
        ]
    },

    postProcess: {
        alignMode: 'bottom',
        horizontalAlign: 'center',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '循环呼吸微动，底部+水平双重对齐消除晃动',
        extraControls: []
    }
};
