export default {
    id: 'walk',
    label: '走路 (Walk)',
    category: 'movement',
    defaultFrameCount: 6,
    looping: true,
    skipReferenceFrame: true,

    prompt: {
        motion: 'casual walk cycle: the character walks in place at a relaxed, unhurried pace. Legs take very short, gentle steps close to the ground. Arms hang naturally with barely perceptible swing. Torso stays upright with almost no vertical bounce. The overall feel is calm and leisurely.',
        groundRule: 'strict',
        extraRules: [
            'Use VERY SHORT, GENTLE steps — this is a casual stroll, NOT a march or power-walk. Feet stay close to the ground at all times.',
            'The weapon is HELD FIRMLY and STILL in the SAME hand as the reference (Cell 1) — SAME hand, SAME direction, SAME grip. Do NOT flip or mirror the weapon in any frame.',
            'Arms barely move — only the slightest natural sway, nearly imperceptible.',
            'Vertical bounce is MINIMAL — the character\'s head height stays nearly constant across all frames.',
            'Each frame must show a subtly different leg position to create smooth walking motion.',
            'Character silhouette should remain very similar across all frames — only the legs and feet change noticeably.'
        ]
    },

    postProcess: {
        alignMode: 'bottom',
        horizontalAlign: 'center',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '悠闲走路循环，短步幅，武器固定，底部+水平对齐',
        extraControls: []
    }
};
