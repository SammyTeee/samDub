#include <JuceHeader.h>

class DubstationAudio : public juce::AudioAppComponent, private juce::Timer
{
public:
    DubstationAudio() : filter(juce::dsp::IIR::Coefficients<float>::makeLowPass(44100.0, 4200.0f))
    {
        setSize(1100, 700);
        setAudioChannels(0, 2);
        startTimerHz(30);
    }

    ~DubstationAudio() override { shutdownAudio(); }

    void prepareToPlay(int samplesPerBlock, double sampleRate) override
    {
        juce::dsp::ProcessSpec spec { sampleRate, (juce::uint32) samplesPerBlock, 2 };
        filter.prepare(spec); delay.prepare(spec); reverb.prepare(spec);
        filter.reset(); delay.reset(); reverb.reset();
        delay.setMaximumDelayInSamples((int) (sampleRate * 2.0));
        delay.setDelay(0.5f * (float) sampleRate);
        reverb.setParameters({ 0.55f, 0.35f, 0.65f, 0.25f, 0.0f });
        phase = 0.0;
    }

    void releaseResources() override {}

    void getNextAudioBlock(const juce::AudioSourceChannelInfo& info) override
    {
        info.clearActiveBufferRegion();
        auto* buffer = info.buffer;
        const auto start = info.startSample;
        const auto count = info.numSamples;
        const auto sr = getSampleRate();
        if (siren.load())
        {
            auto* left = buffer->getWritePointer(0, start);
            auto* right = buffer->getNumChannels() > 1 ? buffer->getWritePointer(1, start) : left;
            const auto hz = sirenPitch.load();
            const auto level = sirenLevel.load();
            for (int i = 0; i < count; ++i)
            {
                phase += (juce::MathConstants<double>::twoPi * hz) / sr;
                if (phase > juce::MathConstants<double>::twoPi) phase -= juce::MathConstants<double>::twoPi;
                const auto sample = (float) std::sin(phase) * level;
                left[i] += sample; right[i] += sample;
            }
        }
        juce::dsp::AudioBlock<float> block(*buffer, (size_t) start, (size_t) count);
        juce::dsp::ProcessContextReplacing<float> context(block);
        filter.state = juce::dsp::IIR::Coefficients<float>::makeLowPass(sr, cutoff.load());
        filter.process(context);
        if (delaySend.load() > 0.001f) { delay.process(context); }
        if (space.load() > 0.001f) { reverb.process(context); }
    }

    void paint(juce::Graphics& g) override
    {
        g.fillAll(juce::Colour::fromRGB(11, 13, 14));
        g.setColour(juce::Colour::fromRGB(196, 243, 74)); g.setFont(juce::Font(26.0f, juce::Font::bold));
        g.drawText("DUBSTATION", 34, 26, 400, 40, juce::Justification::left);
        g.setColour(juce::Colours::lightgrey); g.setFont(juce::Font(14.0f));
        g.drawText("NATIVE AUDIO ENGINE  /  ASIO READY", 36, 70, 500, 24, juce::Justification::left);
        drawMeter(g, 36, 140, 1000, 115);
        drawLabel(g, "FILTER CUTOFF", 60, 310, cutoff.load(), 80.0f, "Hz");
        drawLabel(g, "ECHO THROW", 300, 310, delaySend.load() * 100.0f, 100.0f, "%");
        drawLabel(g, "SPACE", 540, 310, space.load() * 100.0f, 100.0f, "%");
        drawLabel(g, "SIREN", 780, 310, sirenLevel.load() * 100.0f, 100.0f, "%");
        g.setColour(juce::Colour::fromRGB(120, 130, 126)); g.drawText("Q W E R / A S D F   ·   ONE-SHOT TRIGGERS", 38, 515, 600, 22, juce::Justification::left);
    }

    void mouseDown(const juce::MouseEvent& e) override
    {
        if (e.y > 280 && e.y < 470) { const auto index = juce::jlimit(0, 3, (e.x - 36) / 240); setValue(index, juce::jlimit(0.0f, 1.0f, (e.x % 240) / 240.0f)); repaint(); }
        if (e.y > 500) triggerHit();
    }

private:
    juce::dsp::IIR::Filter<float> filter; juce::dsp::DelayLine<float> delay { 88200 }; juce::dsp::Reverb reverb;
    std::atomic<float> cutoff { 4200.0f }, delaySend { 0.54f }, space { 0.38f }, sirenLevel { 0.22f }, sirenPitch { 440.0f };
    std::atomic<bool> siren { false }; double phase = 0.0;

    void setValue(int index, float value) { if (index == 0) cutoff.store(120.0f + value * 10000.0f); if (index == 1) delaySend.store(value); if (index == 2) space.store(value); if (index == 3) sirenLevel.store(value); }
    void triggerHit() { siren.store(true); juce::Timer::callAfterDelay(180, [this] { siren.store(false); }); }
    void drawMeter(juce::Graphics& g, int x, int y, int w, int h) { g.setColour(juce::Colour::fromRGB(18, 24, 23)); g.fillRoundedRectangle((float)x,(float)y,(float)w,(float)h,4.0f); g.setColour(juce::Colour::fromRGB(38, 70, 61)); for (int i=0;i<52;++i) g.fillRect((float)(x+20+i*18), (float)(y+30+(i%5)*7), 9.0f, (float)(h-58-(i%5)*7)); }
    void drawLabel(juce::Graphics& g, const juce::String& text, int x, int y, float value, float max, const juce::String& unit) { g.setColour(juce::Colour::fromRGB(196,243,74)); g.setFont(juce::Font(16.0f)); g.drawText(juce::String(value, 0) + " " + unit, x, y, 200, 28, juce::Justification::left); g.setColour(juce::Colours::lightgrey); g.setFont(juce::Font(12.0f)); g.drawText(text, x, y+32, 200, 22, juce::Justification::left); g.setColour(juce::Colour::fromRGB(47,57,54)); g.fillRect((float)x,(float)y+65.0f,200.0f,4.0f); g.setColour(juce::Colour::fromRGB(196,243,74)); g.fillRect((float)x,(float)y+65.0f,200.0f*juce::jlimit(0.0f,1.0f,value/max),4.0f); }
    void timerCallback() override { repaint(); }
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(DubstationAudio)
};

class DubstationApp : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "Dubstation"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    void initialise(const juce::String&) override { mainWindow.reset(new Window(getApplicationName())); }
    void shutdown() override { mainWindow.reset(); }
    class Window : public juce::DocumentWindow { public: Window(juce::String name) : DocumentWindow(name, juce::Colours::black, allButtons) { setUsingNativeTitleBar(true); setContentOwned(new DubstationAudio(), true); centreWithSize(getWidth(), getHeight()); setResizable(true,true); setVisible(true); } void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); } };
private: std::unique_ptr<Window> mainWindow;
};

START_JUCE_APPLICATION(DubstationApp)
