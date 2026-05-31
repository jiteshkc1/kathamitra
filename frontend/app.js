/**
 * KATHA MITRA - Main Application Logic
 */

const API_BASE = '/api';
const AUTO_HANDS_FREE = true;
const ANALYTICS_USER_KEY = 'kathaMitraAnonUserId';
const ANALYTICS_SESSION_ID_KEY = 'kathaMitraSessionId';
const ANALYTICS_SESSION_START_KEY = 'kathaMitraSessionStartMs';

let wakeLockSentinel = null;

const STATE = {
    currentScreen: 'screen-landing',
    emotions: [],
    currentStory: null,
    quizAttempt: 0,
    quizCompleted: false,
    reflectionResponses: [],
    history: JSON.parse(localStorage.getItem('kathaMitraHistory') || '[]'),
    storyPlayback: {
        isPlaying: false,
        isPaused: false,
        completed: false
    },
    analytics: {
        sessionStartedTracked: false,
        currentStoryStartedAt: null
    }
};

const DOM = {
    screens: document.querySelectorAll('.screen'),
    landing: document.getElementById('screen-landing'),
    emotions: document.getElementById('screen-emotions'),
    story: document.getElementById('screen-story'),
    feedback: document.getElementById('screen-feedback'),
    quiz: document.getElementById('screen-quiz'),
    reflect: document.getElementById('screen-reflect'),
    farewell: document.getElementById('screen-farewell'),

    btnStart: document.getElementById('btn-start'),
    btnPauseStory: document.getElementById('btn-pause-story'),
    btnPlayStory: document.getElementById('btn-play-story'),
    btnSkipStory: document.getElementById('btn-skip-story'),
    btnSkipFeedback: document.getElementById('btn-skip-feedback'),
    btnReflectDone: document.getElementById('btn-reflect-done'),

    btnMicEmotion: document.getElementById('btn-mic-emotion'),
    btnMicFeedback: document.getElementById('btn-mic-feedback'),
    btnMicReflect: document.getElementById('btn-mic-reflect'),

    indEmotion: document.getElementById('listening-indicator'),
    indFeedback: document.getElementById('feedback-listening'),
    indReflect: document.getElementById('reflect-listening'),

    emotionGrid: document.getElementById('emotion-grid'),

    storyTitle: document.getElementById('story-title'),
    storySource: document.getElementById('story-source-badge'),
    storyText: document.getElementById('story-text-content'),
    waveform: document.getElementById('waveform'),
    statusText: document.getElementById('narration-status'),

    quizQuestion: document.getElementById('quiz-question'),
    quizOptions: document.getElementById('quiz-options'),
    quizResult: document.getElementById('quiz-result'),
    quizResultIcon: document.getElementById('quiz-result-icon'),
    quizResultText: document.getElementById('quiz-result-text'),
    quizExplanation: document.getElementById('quiz-explanation'),
    quizExplanationText: document.getElementById('quiz-explanation-text'),
    quizInstruction: document.getElementById('quiz-instruction'),

    reflectQuestion: document.getElementById('reflect-question'),
    characterList: document.getElementById('character-list'),
    reflectResponse: document.getElementById('reflect-response'),
    reflectResponseText: document.getElementById('reflect-response-text'),

    storiesCount: document.getElementById('stories-heard-count'),
    browserWarning: document.getElementById('browser-warning')
};

document.addEventListener('DOMContentLoaded', () => {
    initializeAnalyticsSession();

    if (!speechService.isSTTSupported() || !speechService.isTTSSupported()) {
        DOM.browserWarning.style.display = 'block';
    }

    DOM.btnStart.addEventListener('click', handleStartClick);
    DOM.btnPauseStory.addEventListener('click', toggleStoryPause);
    DOM.btnPlayStory.addEventListener('click', playCurrentStory);
    DOM.btnSkipStory.addEventListener('click', () => {
        speechService.cancelAll();
        resetStoryPlaybackState();
        trackEvent('story_skipped', getStoryAnalyticsPayload());
        navigateToFeedback();
    });
    DOM.btnSkipFeedback.addEventListener('click', () => {
        trackEvent('feedback_skipped', {});
        navigateToQuiz();
    });
    DOM.btnReflectDone.addEventListener('click', finishReflection);

    DOM.btnMicEmotion.addEventListener('click', handleEmotionMicClick);
    DOM.btnMicFeedback.addEventListener('click', handleFeedbackMicClick);
    DOM.btnMicReflect.addEventListener('click', handleReflectMicClick);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && shouldHoldWakeLock()) {
            requestWakeLock();
        }
    });

    window.addEventListener('pagehide', () => {
        trackEvent('session_pagehide', {
            duration_seconds: getSessionDurationSeconds()
        }, true);
    });

    updateHistoryCount();
});

function createRandomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `km-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initializeAnalyticsSession() {
    if (!localStorage.getItem(ANALYTICS_USER_KEY)) {
        localStorage.setItem(ANALYTICS_USER_KEY, createRandomId());
    }

    if (!sessionStorage.getItem(ANALYTICS_SESSION_ID_KEY)) {
        sessionStorage.setItem(ANALYTICS_SESSION_ID_KEY, createRandomId());
    }

    if (!sessionStorage.getItem(ANALYTICS_SESSION_START_KEY)) {
        sessionStorage.setItem(ANALYTICS_SESSION_START_KEY, String(Date.now()));
    }
}

function getAnonymousUserId() {
    return localStorage.getItem(ANALYTICS_USER_KEY);
}

function getSessionId() {
    return sessionStorage.getItem(ANALYTICS_SESSION_ID_KEY);
}

function getSessionStartMs() {
    return Number(sessionStorage.getItem(ANALYTICS_SESSION_START_KEY) || Date.now());
}

function getSessionDurationSeconds() {
    return Math.max(0, Math.round((Date.now() - getSessionStartMs()) / 1000));
}

function trackEvent(eventName, metadata = {}, useBeacon = false) {
    const payload = {
        event_name: eventName,
        anonymous_user_id: getAnonymousUserId(),
        session_id: getSessionId(),
        screen: STATE.currentScreen,
        story_id: STATE.currentStory ? STATE.currentStory.id : null,
        timestamp: new Date().toISOString(),
        duration_seconds: metadata.duration_seconds ?? null,
        metadata
    };

    try {
        if (useBeacon && navigator.sendBeacon) {
            const body = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            navigator.sendBeacon(`${API_BASE}/analytics`, body);
            return;
        }

        fetch(`${API_BASE}/analytics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch((error) => {
            console.error('Analytics request failed:', error);
        });
    } catch (error) {
        console.error('Analytics tracking error:', error);
    }
}

function getStoryAnalyticsPayload(extra = {}) {
    return {
        rasa: STATE.currentStory ? STATE.currentStory.rasa : null,
        source: STATE.currentStory ? STATE.currentStory.source : null,
        title: STATE.currentStory ? STATE.currentStory.title : null,
        ...extra
    };
}

async function handleStartClick() {
    if (!STATE.analytics.sessionStartedTracked) {
        STATE.analytics.sessionStartedTracked = true;
        trackEvent('session_started', {
            entry_point: 'start_button'
        });
    }

    await navigateToEmotions();
}

function showScreen(screenId) {
    speechService.cancelAll();
    if (STATE.currentScreen === 'screen-story' && screenId !== 'screen-story') {
        resetStoryPlaybackState();
    }
    DOM.screens.forEach((screen) => screen.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
        STATE.currentScreen = screenId;
    }
}

function scheduleScreenAction(screenId, action, delay = 600) {
    window.setTimeout(() => {
        if (STATE.currentScreen === screenId) {
            action();
        }
    }, delay);
}

function shouldHoldWakeLock() {
    return [
        'screen-emotions',
        'screen-story',
        'screen-feedback',
        'screen-quiz',
        'screen-reflect'
    ].includes(STATE.currentScreen);
}

async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLockSentinel) {
        return;
    }

    try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
            wakeLockSentinel = null;
        });
    } catch (error) {
        console.error('Wake lock request failed:', error);
    }
}

async function releaseWakeLock() {
    if (!wakeLockSentinel) {
        return;
    }

    try {
        await wakeLockSentinel.release();
    } catch (error) {
        console.error('Wake lock release failed:', error);
    } finally {
        wakeLockSentinel = null;
    }
}

function canAutoplayStory() {
    const userAgent = navigator.userAgent || '';
    return !userAgent.includes('Edg/');
}

async function navigateToEmotions() {
    showScreen('screen-emotions');
    await requestWakeLock();
    trackEvent('screen_viewed', { screen_name: 'emotions' });

    if (STATE.emotions.length === 0) {
        try {
            const res = await fetch(`${API_BASE}/emotions`);
            const data = await res.json();
            STATE.emotions = data.emotions;
            renderEmotionGrid(data.emotions);
        } catch (error) {
            console.error('Failed to load emotions:', error);
            const fallback = [
                { rasa: 'शृंगार', emoji: '💕', label_hindi: 'प्रेम' },
                { rasa: 'हास्य', emoji: '😄', label_hindi: 'हँसी' },
                { rasa: 'वीर', emoji: '💪', label_hindi: 'वीरता' }
            ];
            STATE.emotions = fallback;
            renderEmotionGrid(fallback);
        }
    }

    await speechService.speak('आप किस भाव की कहानी सुनना चाहेंगे?');
    if (AUTO_HANDS_FREE) {
        scheduleScreenAction('screen-emotions', handleEmotionMicClick);
    }
}

function renderEmotionGrid(emotions) {
    DOM.emotionGrid.innerHTML = '';

    emotions.forEach((emotion) => {
        const card = document.createElement('div');
        card.className = 'emotion-card';
        card.innerHTML = `
            <div class="emotion-emoji">${emotion.emoji}</div>
            <div class="emotion-label">${emotion.label_hindi}</div>
        `;
        card.addEventListener('click', () => selectEmotion(emotion.rasa, card));
        DOM.emotionGrid.appendChild(card);
    });
}

async function handleEmotionMicClick() {
    toggleMicUI(DOM.btnMicEmotion, DOM.indEmotion, true);
    try {
        const transcript = await speechService.listenUntilPause(2000);
        toggleMicUI(DOM.btnMicEmotion, DOM.indEmotion, false);

        if (!transcript) {
            await speechService.speak('मैं सुन नहीं पाया। कृपया फिर से बोलें।');
            if (AUTO_HANDS_FREE) {
                scheduleScreenAction('screen-emotions', handleEmotionMicClick);
            }
            return;
        }

        const matchedRasa = matchEmotionTranscript(transcript);
        if (!matchedRasa) {
            await speechService.speak('मैं समझ नहीं पाया। कृपया फिर से बोलें, या नीचे दिए गए विकल्पों में से चुनें।');
            if (AUTO_HANDS_FREE) {
                scheduleScreenAction('screen-emotions', handleEmotionMicClick);
            }
            return;
        }

        const cards = DOM.emotionGrid.querySelectorAll('.emotion-card');
        const idx = STATE.emotions.findIndex((emotion) => emotion.rasa === matchedRasa);
        if (idx !== -1 && cards[idx]) {
            await selectEmotion(matchedRasa, cards[idx]);
        } else {
            await selectEmotion(matchedRasa);
        }
    } catch (error) {
        console.error(error);
        toggleMicUI(DOM.btnMicEmotion, DOM.indEmotion, false);
        if (error.message) await speechService.speak(error.message);
    }
}

function matchEmotionTranscript(text) {
    const normalized = text.toLowerCase();
    const mappings = {
        'शृंगार': ['प्रेम', 'प्यार', 'शृंगार', 'मोहब्बत', 'रोमांस'],
        'हास्य': ['हँसी', 'हास्य', 'मज़ाकिया', 'चुटकुला', 'हंसी'],
        'करुण': ['करुणा', 'दुख', 'दर्द', 'उदासी', 'करुण'],
        'रौद्र': ['क्रोध', 'गुस्सा', 'रौद्र', 'नाराज़गी'],
        'वीर': ['वीरता', 'साहस', 'बहादुरी', 'वीर', 'शूरवीर'],
        'भयानक': ['भय', 'डर', 'भयानक', 'डरावना'],
        'बीभत्स': ['घृणा', 'बीभत्स', 'नफरत'],
        'अद्भुत': ['अद्भुत', 'अचंभा', 'आश्चर्य', 'जादू'],
        'शांत': ['शांति', 'शांत', 'सुकून', 'ज्ञान']
    };

    for (const [rasa, keywords] of Object.entries(mappings)) {
        if (keywords.some((keyword) => normalized.includes(keyword))) {
            return rasa;
        }
    }
    return null;
}

async function selectEmotion(rasa, cardElement = null) {
    if (cardElement) {
        document.querySelectorAll('.emotion-card').forEach((card) => card.classList.remove('selected'));
        cardElement.classList.add('selected');
    }

    trackEvent('emotion_selected', { rasa });
    await speechService.speak('ठीक है, आपके लिए एक कहानी खोजी जा रही है।');
    await fetchAndPlayStory(rasa);
}

async function fetchAndPlayStory(rasa) {
    showScreen('screen-story');
    await requestWakeLock();
    resetStoryPlaybackState();
    setStoryControlsState('loading');
    DOM.statusText.textContent = 'कहानी खोजी जा रही है...';
    DOM.waveform.classList.remove('active');
    trackEvent('screen_viewed', { screen_name: 'story_loading', rasa });

    try {
        const excludeIds = STATE.history.join(',');
        const res = await fetch(`${API_BASE}/story?rasa=${rasa}&exclude=${excludeIds}`);
        if (!res.ok) throw new Error('Story not found');

        const data = await res.json();
        const story = data.story;
        STATE.currentStory = story;
        STATE.analytics.currentStoryStartedAt = null;
        resetStoryPlaybackState();

        DOM.storyTitle.textContent = story.title;
        DOM.storySource.textContent = story.source;
        DOM.storyText.textContent = story.story_text;

        if (!STATE.history.includes(story.id)) {
            STATE.history.push(story.id);
            localStorage.setItem('kathaMitraHistory', JSON.stringify(STATE.history));
            updateHistoryCount();
        }

        trackEvent('story_loaded', getStoryAnalyticsPayload({ rasa }));

        if (AUTO_HANDS_FREE && canAutoplayStory()) {
            DOM.statusText.textContent = 'कहानी तैयार है। अब कहानी सुनाई जाएगी।';
            scheduleScreenAction('screen-story', playCurrentStory, 500);
        } else {
            setStoryControlsState('ready');
            DOM.statusText.textContent = 'कहानी तैयार है।';
        }
    } catch (error) {
        console.error('Story fetch error:', error);
        resetStoryPlaybackState();
        setStoryControlsState('failed');
        DOM.statusText.textContent = 'क्षमा करें, इस भाव की नई कहानी नहीं मिली।';
        trackEvent('story_load_failed', { rasa, message: error.message });
        await speechService.speak('क्षमा करें, इस भाव की नई कहानी नहीं मिली। कृपया कोई और भाव चुनें।');
        setTimeout(navigateToEmotions, 3000);
    }
}

async function navigateToFeedback() {
    showScreen('screen-feedback');
    await requestWakeLock();
    trackEvent('screen_viewed', { screen_name: 'feedback' });
    await speechService.speak('कहानी कैसी लगी?');
    if (AUTO_HANDS_FREE) {
        scheduleScreenAction('screen-feedback', handleFeedbackMicClick);
    }
}

async function handleFeedbackMicClick() {
    toggleMicUI(DOM.btnMicFeedback, DOM.indFeedback, true);
    try {
        const feedbackTranscript = await speechService.listenUntilPause(2000);
        toggleMicUI(DOM.btnMicFeedback, DOM.indFeedback, false);
        trackEvent('feedback_recorded', {
            has_feedback: Boolean(feedbackTranscript),
            transcript_length: feedbackTranscript ? feedbackTranscript.length : 0
        });
        await speechService.speak('धन्यवाद! अब देखते हैं आपको कहानी कितनी याद है।');
        navigateToQuiz();
    } catch (error) {
        toggleMicUI(DOM.btnMicFeedback, DOM.indFeedback, false);
        navigateToQuiz();
    }
}

async function navigateToQuiz() {
    if (!STATE.currentStory) {
        navigateToEmotions();
        return;
    }

    showScreen('screen-quiz');
    await requestWakeLock();
    STATE.quizAttempt = 0;
    STATE.quizCompleted = false;
    DOM.quizResult.style.display = 'none';
    DOM.quizExplanation.style.display = 'none';
    DOM.quizQuestion.textContent = STATE.currentStory.recall_question;
    DOM.quizInstruction.textContent = 'सही विकल्प पर दबाएँ';
    renderQuizOptions();

    trackEvent('screen_viewed', { screen_name: 'quiz' });
    await speechService.speak(`अब एक याद रखने वाला सवाल। ${STATE.currentStory.recall_question}`);
}

function renderQuizOptions() {
    DOM.quizOptions.innerHTML = '';
    const options = STATE.currentStory.quiz_options || [];

    options.forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quiz-option';
        button.dataset.option = option;
        button.innerHTML = `
            <span class="quiz-option-index">${index + 1}</span>
            <span class="quiz-option-text">${option}</span>
        `;
        button.addEventListener('click', () => submitQuizAnswer(option));
        DOM.quizOptions.appendChild(button);
    });
}

async function submitQuizAnswer(answer) {
    if (STATE.quizCompleted) return;
    STATE.quizAttempt++;
    const correctAnswer = STATE.currentStory.correct_answer;
    const isCorrect = answer === correctAnswer;

    if (isCorrect) {
        STATE.quizCompleted = true;
        showQuizResult(true, `बिल्कुल सही जवाब! बहुत बढ़िया। सही उत्तर है: ${correctAnswer}`);
        highlightQuizOption(correctAnswer, 'correct');
        disableQuizOptions();
        trackEvent('quiz_completed', {
            correct: true,
            attempt: STATE.quizAttempt
        });
        await speechService.speak(`बिल्कुल सही जवाब! बहुत बढ़िया। सही उत्तर है: ${correctAnswer}`);
        setTimeout(navigateToReflect, 1800);
        return;
    }

    highlightQuizOption(answer, 'wrong');

    if (STATE.quizAttempt === 1) {
        showQuizResult(false, 'यह जवाब सही नहीं है। फिर से प्रयास करें।');
        DOM.quizInstruction.textContent = 'एक बार और कोशिश करें';
        trackEvent('quiz_retry_needed', { attempt: STATE.quizAttempt });
        await speechService.speak('यह जवाब सही नहीं है। फिर से प्रयास करें।');
        return;
    }

    STATE.quizCompleted = true;
    highlightQuizOption(correctAnswer, 'correct');
    disableQuizOptions();
    DOM.quizExplanationText.textContent = STATE.currentStory.answer_explanation || `कहानी में बताया गया था कि ${correctAnswer}।`;
    DOM.quizExplanation.style.display = 'block';
    showQuizResult(false, `सही जवाब है: ${correctAnswer}`);
    trackEvent('quiz_completed', {
        correct: false,
        attempt: STATE.quizAttempt
    });
    await speechService.speak(`यह जवाब सही नहीं है। सही जवाब है: ${correctAnswer}। ${DOM.quizExplanationText.textContent}`);
    setTimeout(navigateToReflect, 3200);
}

function showQuizResult(isCorrect, text) {
    DOM.quizResult.style.display = 'flex';
    DOM.quizResult.className = `quiz-result ${isCorrect ? 'correct' : 'wrong'}`;
    DOM.quizResultIcon.textContent = isCorrect ? '✅' : '❌';
    DOM.quizResultText.textContent = text;
}

async function navigateToReflect() {
    showScreen('screen-reflect');
    await requestWakeLock();
    STATE.reflectionResponses = [];
    DOM.reflectResponse.style.display = 'none';
    DOM.btnMicReflect.style.display = 'flex';
    DOM.btnReflectDone.style.display = 'inline-flex';
    DOM.btnReflectDone.disabled = false;
    DOM.reflectQuestion.textContent = STATE.currentStory.reflection_question;

    DOM.characterList.innerHTML = '';
    const chars = STATE.currentStory.characters;
    if (Array.isArray(chars)) {
        chars.forEach((char) => {
            const chip = document.createElement('div');
            chip.className = 'character-chip';
            chip.textContent = char;
            chip.addEventListener('click', () => handleReflectTap(char, chip));
            DOM.characterList.appendChild(chip);
        });
    }

    trackEvent('screen_viewed', { screen_name: 'reflection' });
    await speechService.speak(`एक और सवाल। ${STATE.currentStory.reflection_question} आप अपनी बात बोलिए। जब आपकी बात पूरी हो जाए, तब done दबाएँ।`);
    if (AUTO_HANDS_FREE) {
        scheduleScreenAction('screen-reflect', handleReflectMicClick);
    }
}

async function handleReflectMicClick() {
    toggleMicUI(DOM.btnMicReflect, DOM.indReflect, true);
    try {
        const answer = await speechService.listenUntilPause(3000);
        toggleMicUI(DOM.btnMicReflect, DOM.indReflect, false);

        if (!answer) {
            await speechService.speak('मुझे कुछ सुनाई नहीं दिया। कृपया फिर से बोलें।');
            trackEvent('reflection_no_answer', {});
            return;
        }

        const res = await fetch(`${API_BASE}/validate-character`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                story_id: STATE.currentStory.id,
                character_name: answer
            })
        });
        const data = await res.json();

        if (data.valid && data.matched_character) {
            const chips = Array.from(DOM.characterList.children);
            const matchChip = chips.find((chip) => chip.textContent === data.matched_character);
            if (matchChip) {
                chips.forEach((chip) => chip.classList.remove('selected'));
                matchChip.classList.add('selected');
            }
        }

        updateReflectionSummary(answer);
    } catch (error) {
        console.error(error);
        toggleMicUI(DOM.btnMicReflect, DOM.indReflect, false);
    }
}

function handleReflectTap(charName, chipElement) {
    document.querySelectorAll('.character-chip').forEach((chip) => chip.classList.remove('selected'));
    chipElement.classList.add('selected');
    updateReflectionSummary(charName);
}

function updateReflectionSummary(answer) {
    if (!answer) return;

    STATE.reflectionResponses.push(answer);
    DOM.reflectResponseText.textContent = STATE.reflectionResponses.join(' ');
    DOM.reflectResponse.style.display = 'block';
    trackEvent('reflection_response_recorded', {
        response_count: STATE.reflectionResponses.length,
        response_length: answer.length
    });
}

async function finishReflection() {
    const closingMessage = 'आपने अपने मन के विचार मुझसे साझा करने के लिए आपका धन्यवाद। आपको सुनकर अच्छा लगा। आपका समय और जीवन मंगलमय रहे। आशा है इस कहानी से आपको प्रेरणा मिलेगी। अगली कहानी सुनने के पहले इस कहानी पर थोड़ा समय चिंतन करिए। राधे कृष्ण राधे कृष्ण।';
    const storyDurationSeconds = STATE.analytics.currentStoryStartedAt
        ? Math.max(0, Math.round((Date.now() - STATE.analytics.currentStoryStartedAt) / 1000))
        : null;

    trackEvent('reflection_done', {
        response_count: STATE.reflectionResponses.length
    });
    trackEvent('session_completed', {
        duration_seconds: getSessionDurationSeconds(),
        story_duration_seconds: storyDurationSeconds
    }, true);

    speechService.cancelAll();
    DOM.btnMicReflect.style.display = 'none';
    DOM.btnReflectDone.disabled = true;
    DOM.reflectResponseText.textContent = closingMessage;
    DOM.reflectResponse.style.display = 'block';
    await speechService.speak(closingMessage);
    setTimeout(navigateToFarewell, 2000);
}

async function navigateToFarewell() {
    showScreen('screen-farewell');
    await releaseWakeLock();
    trackEvent('screen_viewed', { screen_name: 'farewell' });
    updateHistoryCount();
    await speechService.speak('आपकी भागीदारी के लिए धन्यवाद! फिर मिलेंगे, एक और कहानी के साथ!');
}

function toggleMicUI(btnElement, indicatorElement, isListening) {
    if (isListening) {
        btnElement.classList.add('listening');
        indicatorElement.style.display = 'flex';
    } else {
        btnElement.classList.remove('listening');
        indicatorElement.style.display = 'none';
    }
}

function updateHistoryCount() {
    const count = STATE.history.length;
    if (count > 0) {
        DOM.storiesCount.textContent = `आपने अब तक ${count} कहानियाँ सुनी हैं।`;
    }
}

function resetStoryPlaybackState() {
    STATE.storyPlayback.isPlaying = false;
    STATE.storyPlayback.isPaused = false;
    STATE.storyPlayback.completed = false;
    DOM.btnPauseStory.textContent = 'रोकें';
}

function updateStoryPauseButton() {
    DOM.btnPauseStory.textContent = STATE.storyPlayback.isPaused ? 'फिर चलाएँ' : 'रोकें';
}

async function toggleStoryPause() {
    if (!STATE.storyPlayback.isPlaying) return;

    if (STATE.storyPlayback.isPaused) {
        const resumed = speechService.resume();
        if (!resumed) return;
        STATE.storyPlayback.isPaused = false;
        DOM.waveform.classList.add('active');
        DOM.statusText.textContent = 'कहानी सुनाई जा रही है...';
        updateStoryPauseButton();
        trackEvent('story_resumed', getStoryAnalyticsPayload());
        return;
    }

    const paused = speechService.pause();
    if (!paused) return;
    STATE.storyPlayback.isPaused = true;
    DOM.waveform.classList.remove('active');
    DOM.statusText.textContent = 'कहानी रुकी हुई है। चाहें तो फिर चलाएँ।';
    updateStoryPauseButton();
    trackEvent('story_paused', getStoryAnalyticsPayload());
}

function highlightQuizOption(optionText, state) {
    const options = DOM.quizOptions.querySelectorAll('.quiz-option');
    options.forEach((option) => {
        option.classList.remove('correct', 'wrong');
        if (option.dataset.option === optionText) {
            option.classList.add(state);
        }
    });
}

function disableQuizOptions() {
    DOM.quizOptions.querySelectorAll('.quiz-option').forEach((option) => {
        option.disabled = true;
    });
}

function setStoryControlsState(state) {
    const textDisplay = document.getElementById('story-text-display');
    DOM.btnPauseStory.disabled = true;

    if (state === 'playing' || state === 'loading') {
        textDisplay.style.display = 'none';
        DOM.btnPlayStory.disabled = true;
        DOM.btnSkipStory.disabled = true;
        if (state === 'playing') {
            DOM.btnPauseStory.disabled = false;
        }
        return;
    }

    textDisplay.style.display = 'block';

    if (state === 'finished' || state === 'failed' || state === 'ready') {
        DOM.btnPlayStory.disabled = false;
        DOM.btnSkipStory.disabled = false;
    }
}

async function playCurrentStory() {
    if (!STATE.currentStory || STATE.storyPlayback.isPlaying) return;

    const story = STATE.currentStory;
    await requestWakeLock();
    resetStoryPlaybackState();
    STATE.storyPlayback.isPlaying = true;
    STATE.analytics.currentStoryStartedAt = Date.now();
    trackEvent('story_started', getStoryAnalyticsPayload());
    setStoryControlsState('playing');
    DOM.waveform.classList.add('active');
    DOM.statusText.textContent = 'कहानी सुनाई जा रही है...';
    updateStoryPauseButton();

    const fullText = `${story.title}। यह कहानी ${story.source} से है। ${story.story_text}`;
    const played = await speechService.speak(fullText);
    const wasCancelled = !STATE.storyPlayback.isPlaying;

    if (wasCancelled) {
        return;
    }

    STATE.storyPlayback.isPlaying = false;
    STATE.storyPlayback.isPaused = false;

    if (!played) {
        DOM.waveform.classList.remove('active');
        setStoryControlsState('failed');
        DOM.statusText.textContent = 'आवाज़ शुरू नहीं हो सकी। फिर से सुनें या आगे बढ़ें।';
        trackEvent('story_playback_failed', getStoryAnalyticsPayload());
        return;
    }

    DOM.waveform.classList.remove('active');
    STATE.storyPlayback.completed = true;
    setStoryControlsState('finished');
    DOM.statusText.textContent = 'कहानी समाप्त।';
    trackEvent('story_finished', getStoryAnalyticsPayload({
        duration_seconds: STATE.analytics.currentStoryStartedAt
            ? Math.max(0, Math.round((Date.now() - STATE.analytics.currentStoryStartedAt) / 1000))
            : null
    }));
}
