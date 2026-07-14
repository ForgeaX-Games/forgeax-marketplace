export default {
    id: 'death',
    label: '死亡 (Death)',
    category: 'special',
    defaultFrameCount: 6,
    looping: false,

    prompt: {
        motion: 'death sequence: the character staggers backward from a fatal blow, loses balance, and falls to the ground. The final frame shows the character lying down.',
        groundRule: 'fall',
        extraRules: [
            'Frame 1: standing, reacting to hit. Frame 2: stagger. Frames 3-4: falling. Frames 5-6: collapsed on the ground.',
            'The final frame should be a clear "dead" resting pose (lying flat or slumped).',
            'This is NOT a loop — it ends with the character on the ground.'
        ]
    },

    postProcess: {
        alignMode: 'none',
        horizontalAlign: 'none',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '倒地死亡，不做对齐（保留自然倒地过程）',
        extraControls: []
    }
};
