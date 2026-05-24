/**
 * KATHA MITRA - Main Application Logic
 */

const API_BASE = '/api';
const AUTO_HANDS_FREE = true;

const STATE = {
    currentScreen: 'screen-landing',
    emotions: [],
    currentStory: null,
    quizAttempt: 0,
    reflectionResponses: [],
    history: JSON.parse(localStorage.getItem('kathaMitraHistory') || '[]')
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
    btnPlayStory: document.getElementById('btn-play-story'),
    btnSkipStory: document.getElementById('btn-skip-story'),
    btnSkipFeedback: document.getElementById('btn-skip-feedback'),
    btnQuizAction: document.getElementById('btn-quiz-action'),

    btnMicEmotion: document.getElementById('btn-mic-emotion'),
    btnMicFeedback: document.getElementById('btn-mic-feedback'),
    btnMicQuiz: document.getElementById('btn-mic-quiz'),
    btnMicReflect: document.getElementById('btn-mic-reflect'),

    indEmotion: document.getElementById('listening-indicator'),
    indFeedback: document.getElementById('feedback-listening'),
    indQuiz: document.getElementById('quiz-listening'),
    indReflect: document.getElementById('reflect-listening'),

    emotionGrid: document.getElementById('emotion-grid'),

    storyTitle: document.getElementById('story-title'),
    storySource: document.getElementById('story-source-badge'),
    storyText: document.getElementById('story-text-content'),
    waveform: document.getElementById('waveform'),
    statusText: document.getElementById('narration-status'),

    quizQuestion: document.getElementById('quiz-question'),
    quizResult: document.getElementById('quiz-result'),
    quizResultIcon: document.getElementById('quiz-result-icon'),
    quizResultText: document.getElementById('quiz-result-text'),
    quizHint: document.getElementById('quiz-hint'),
    quizHintText: document.getElementById('quiz-hint-text'),
    quizFallback: document.getElementById('quiz-fallback'),
    quizTextInput: document.getElementById('quiz-text-input'),
    btnQuizTextSubmit: document.getElementById('btn-quiz-text-submit'),

    reflectQuestion: document.getElementById('reflect-question'),
    characterList: document.getElementById('character-list'),
    reflectResponse: document.getElementById('reflect-response'),
    reflectResponseText: document.getElementById('reflect-response-text'),

    storiesCount: document.getElementById('stories-heard-count'),
    browserWarning: document.getElementById('browser-warning')
};

document.addEventListener('DOMContentLoaded', () => {
    if (!speechService.isSTTSupported() || !speechService.isTTSSupported()) {
        DOM.browserWarning.style.display = 'block';
    }

    DOM.btnStart.addEventListener('click', navigateToEmotions);
    DOM.btnPlayStory.addEventListener('click', playCurrentStory);
    DOM.btnSkipStory.addEventListener('click', () => {
        speechService.cancelAll();
        navigateToFeedback();
    });
    DOM.btnSkipFeedback.addEventListener('click', navigateToQuiz);
    DOM.btnQuizAction.addEventListener('click', handleQuizMicClick);

    DOM.btnMicEmotion.addEventListener('click', handleEmotionMicClick);
    DOM.btnMicFeedback.addEventListener('click', handleFeedbackMicClick);
    DOM.btnMicQuiz.addEventListener('click', handleQuizMicClick);
    DOM.btnMicReflect.addEventListener('click', handleReflectMicClick);

    DOM.btnQuizTextSubmit.addEventListener('click', () => {
        const answer = DOM.quizTextInput.value.trim();
        if (!answer) return;
        DOM.quizTextInput.value = '';
        submitQuizAnswer(answer);
    });

    updateHistoryCount();
});

function showScreen(screenId) {
    speechService.cancelAll();
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

function canAutoplayStory() {
    const userAgent = navigator.userAgent || '';
    return !userAgent.includes('Edg/');
}

async function navigateToEmotions() {
    showScreen('screen-emotions');

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
        'हास्य': ['हँसी', 'हास्य', 'मजाकिया', 'चुटकुला', 'हंसी'],
        'करुण': ['करुणा', 'दुख', 'दर्द', 'उदासी', 'करुण'],
        'रौद्र': ['क्रोध', 'गुस्सा', 'रौद्र', 'नाराजगी'],
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

    await speechService.speak('ठीक है, मैं आपके लिए एक कहानी ढूँढ रहा हूँ।');
    await fetchAndPlayStory(rasa);
}

async function fetchAndPlayStory(rasa) {
    showScreen('screen-story');
    setStoryControlsState('loading');
    DOM.statusText.textContent = 'कहानी खोजी जा रही है...';
    DOM.waveform.classList.remove('active');

    try {
        const excludeIds = STATE.history.join(',');
        const res = await fetch(`${API_BASE}/story?rasa=${rasa}&exclude=${excludeIds}`);
        if (!res.ok) throw new Error('Story not found');

        const data = await res.json();
        const story = data.story;
        STATE.currentStory = story;

        DOM.storyTitle.textContent = story.title;
        DOM.storySource.textContent = story.source;
        DOM.storyText.textContent = story.story_text;

        if (!STATE.history.includes(story.id)) {
            STATE.history.push(story.id);
            localStorage.setItem('kathaMitraHistory', JSON.stringify(STATE.history));
            updateHistoryCount();
        }

        if (AUTO_HANDS_FREE && canAutoplayStory()) {
            DOM.statusText.textContent = 'कहानी तैयार है। अब कहानी सुनाई जाएगी।';
            scheduleScreenAction('screen-story', playCurrentStory, 500);
        } else {
            setStoryControlsState('ready');
            DOM.statusText.textContent = 'कहानी तैयार है।';
        }
    } catch (error) {
        console.error('Story fetch error:', error);
        setStoryControlsState('failed');
        DOM.statusText.textContent = 'क्षमा करें, इस भाव की नई कहानी नहीं मिली।';
        await speechService.speak('क्षमा करें, इस भाव की नई कहानी नहीं मिली। कृपया कोई और भाव चुनें।');
        setTimeout(navigateToEmotions, 3000);
    }
}

async function navigateToFeedback() {
    showScreen('screen-feedback');
    await speechService.speak('कहानी कैसी लगी?');
    if (AUTO_HANDS_FREE) {
        scheduleScreenAction('screen-feedback', handleFeedbackMicClick);
    }
}

async function handleFeedbackMicClick() {
    toggleMicUI(DOM.btnMicFeedback, DOM.indFeedback, true);
    try {
        await speechService.listenUntilPause(2000);
        toggleMicUI(DOM.btnMicFeedback, DOM.indFeedback, false);
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
    STATE.quizAttempt = 0;
    DOM.quizResult.style.display = 'none';
    DOM.quizHint.style.display = 'none';
    DOM.btnQuizAction.style.display = 'none';
    DOM.btnMicQuiz.style.display = 'flex';
    DOM.quizFallback.style.display = 'none';
    DOM.quizQuestion.textContent = STATE.currentStory.recall_question;

    await speechService.speak(`अब एक सवाल। ${STATE.currentStory.recall_question}`);
    if (AUTO_HANDS_FREE) {
        scheduleScreenAction('screen-quiz', handleQuizMicClick);
    }
}

async function handleQuizMicClick() {
    toggleMicUI(DOM.btnMicQuiz, DOM.indQuiz, true);
    DOM.quizResult.style.display = 'none';
    DOM.btnQuizAction.style.display = 'none';

    try {
        const answer = await speechService.listenUntilPause(3000);
        toggleMicUI(DOM.btnMicQuiz, DOM.indQuiz, false);

        if (!answer) {
            await speechService.speak('मुझे कुछ सुनाई नहीं दिया। कृपया फिर से बोलें।');
            DOM.quizFallback.style.display = 'block';
            if (AUTO_HANDS_FREE) {
                scheduleScreenAction('screen-quiz', handleQuizMicClick);
            }
            return;
        }

        await submitQuizAnswer(answer);
    } catch (error) {
        console.error(error);
        toggleMicUI(DOM.btnMicQuiz, DOM.indQuiz, false);
        DOM.btnQuizAction.style.display = 'block';
    }
}

async function submitQuizAnswer(answer) {
    STATE.quizAttempt++;

    try {
        const res = await fetch(`${API_BASE}/validate-answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                story_id: STATE.currentStory.id,
                user_answer: answer,
                attempt: STATE.quizAttempt
            })
        });
        const data = await res.json();

        if (data.correct) {
            showQuizResult(true, 'बिल्कुल सही जवाब! बहुत बढ़िया।');
            await speechService.speak('बिल्कुल सही जवाब! बहुत बढ़िया।');
            setTimeout(navigateToReflect, 2000);
            return;
        }

        if (STATE.quizAttempt === 1 && data.hint) {
            showQuizResult(false, 'यह जवाब सही नहीं है।');
            DOM.quizHintText.textContent = data.hint;
            DOM.quizHint.style.display = 'block';
            DOM.btnQuizAction.style.display = 'block';
            await speechService.speak(`यह जवाब सही नहीं है। यह रहा एक संकेत। ${data.hint}`);
            if (AUTO_HANDS_FREE) {
                scheduleScreenAction('screen-quiz', handleQuizMicClick, 900);
            }
            return;
        }

        if (data.answer) {
            DOM.quizHint.style.display = 'none';
            DOM.btnMicQuiz.style.display = 'none';
            showQuizResult(false, `सही जवाब है: ${data.answer}`);
            await speechService.speak(`कोई बात नहीं। सही जवाब है: ${data.answer}`);
            setTimeout(navigateToReflect, 3000);
        }
    } catch (error) {
        console.error('Quiz Validation Error:', error);
        DOM.btnQuizAction.style.display = 'block';
    }
}

function showQuizResult(isCorrect, text) {
    DOM.quizResult.style.display = 'flex';
    DOM.quizResult.className = `quiz-result ${isCorrect ? 'correct' : 'wrong'}`;
    DOM.quizResultIcon.textContent = isCorrect ? '✅' : '❌';
    DOM.quizResultText.textContent = text;
}

async function navigateToReflect() {
    showScreen('screen-reflect');
    STATE.reflectionResponses = [];
    DOM.reflectResponse.style.display = 'none';
    DOM.btnMicReflect.style.display = 'flex';
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

    await speechService.speak(`एक और सवाल। ${STATE.currentStory.reflection_question}`);
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
            if (AUTO_HANDS_FREE) {
                scheduleScreenAction('screen-reflect', handleReflectMicClick);
            }
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

        await continueReflection(answer);
    } catch (error) {
        toggleMicUI(DOM.btnMicReflect, DOM.indReflect, false);
    }
}

async function handleReflectTap(charName, chipElement) {
    document.querySelectorAll('.character-chip').forEach((chip) => chip.classList.remove('selected'));
    chipElement.classList.add('selected');
    await continueReflection(charName);
}

async function continueReflection(answer) {
    if (answer) {
        STATE.reflectionResponses.push(answer);
    }

    const wantsMore = await askIfUserHasMoreToSay();
    if (wantsMore) {
        DOM.reflectResponseText.textContent = 'जी, आप और बताइए।';
        DOM.reflectResponse.style.display = 'block';
        await speechService.speak('जी, आप और बताइए।');
        DOM.btnMicReflect.style.display = 'flex';
        if (AUTO_HANDS_FREE) {
            scheduleScreenAction('screen-reflect', handleReflectMicClick);
        }
        return;
    }

    await finishReflection();
}

async function askIfUserHasMoreToSay() {
    const yesKeywords = ['हाँ', 'हां', 'haan', 'yes', 'और', 'ji', 'जी'];
    const noKeywords = ['नहीं', 'नही', 'no', 'बस', 'न', 'nahin', 'done'];

    for (let attempt = 0; attempt < 3; attempt++) {
        await speechService.speak('क्या आप कुछ और कहना चाहेंगे?');
        toggleMicUI(DOM.btnMicReflect, DOM.indReflect, true);

        try {
            const response = await speechService.listenUntilPause(2000);
            toggleMicUI(DOM.btnMicReflect, DOM.indReflect, false);

            const normalized = (response || '').trim().toLowerCase();
            if (!normalized) continue;
            if (yesKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) return true;
            if (noKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) return false;
        } catch (error) {
            toggleMicUI(DOM.btnMicReflect, DOM.indReflect, false);
        }
    }

    return false;
}

async function finishReflection() {
    const closingMessage = 'आपने अपने मन के विचार मुझसे साझा करने के लिए आपका धन्यवाद। आपको सुनकर अच्छा लगा। आपका समय और जीवन मंगलमय हो। आशा है इस कहानी से आपको प्रेरणा मिलेगी। अगली कहानी सुनने के पहले इस कहानी पर थोड़ा समय चिंतन करिए। हरि ॐ तत्सत।';
    DOM.btnMicReflect.style.display = 'none';
    DOM.reflectResponseText.textContent = closingMessage;
    DOM.reflectResponse.style.display = 'block';
    await speechService.speak(closingMessage);
    setTimeout(navigateToFarewell, 2000);
}

async function navigateToFarewell() {
    showScreen('screen-farewell');
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

function setStoryControlsState(state) {
    const textDisplay = document.getElementById('story-text-display');

    if (state === 'playing' || state === 'loading') {
        textDisplay.style.display = 'none';
        DOM.btnPlayStory.disabled = true;
        DOM.btnSkipStory.disabled = true;
        return;
    }

    textDisplay.style.display = 'block';

    if (state === 'finished' || state === 'failed' || state === 'ready') {
        DOM.btnPlayStory.disabled = false;
        DOM.btnSkipStory.disabled = false;
    }
}

async function playCurrentStory() {
    if (!STATE.currentStory) return;

    const story = STATE.currentStory;
    setStoryControlsState('playing');
    DOM.waveform.classList.add('active');
    DOM.statusText.textContent = 'कहानी सुनाई जा रही है...';

    const fullText = `${story.title}। यह कहानी ${story.source} से है। ${story.story_text}`;
    const played = await speechService.speak(fullText);

    if (!played) {
        DOM.waveform.classList.remove('active');
        setStoryControlsState('failed');
        DOM.statusText.textContent = "आवाज़ शुरू नहीं हो सकी। फिर से सुनें या आगे बढ़ें।";
        return;
    }

    DOM.waveform.classList.remove('active');
    setStoryControlsState('finished');
    DOM.statusText.textContent = 'कहानी समाप्त।';
}
