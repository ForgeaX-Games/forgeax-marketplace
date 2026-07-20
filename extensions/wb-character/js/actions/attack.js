export default {
    id: 'attack',
    label: '攻击 (Attack)',
    category: 'combat',
    defaultFrameCount: 6,
    looping: false,

    prompt: {
        motion: 'melee attack: the character winds up, performs a powerful weapon swing, and follows through. Show the full arc of the attack motion from start to finish.',
        groundRule: 'strict',
        extraRules: [
            'Frame 1: ready stance. Frame 2: wind-up. Frames 3-4: swing arc. Frames 5-6: follow-through and recovery.',
            'The weapon arc should be clearly visible across frames.',
            'Feet stay planted — only upper body and arms rotate during the swing.'
        ]
    },

    postProcess: {
        alignMode: 'bottom',
        horizontalAlign: 'none',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '近战攻击全流程，底部对齐',
        extraControls: []
    }
};
