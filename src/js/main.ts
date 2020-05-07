/// <reference path="jquery.d.ts" />

function assert(expression: any) {
    if (!expression) {
        throw new Error("AssertionError!");
    }
}

var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var INTERVAL_NAMES = ["unison", "minor second", "major second", "minor third", "major third", 
                      "perfect fourth", "tritone", "perfect fifth", "minor sixth", "major sixth", 
                      "minor seventh", "major seventh"];

function note_name_from_note(note: number) {
    let mod = note % 12;
    if (mod < 0) {
        mod += 12;
    }
        
    return NOTE_NAMES[mod];
}

function note_from_pitch(frequency: number) {
	let note_num = 12 * (Math.log(frequency / 440) / Math.log(2));
	return Math.round(note_num) + 69;
}

function frequency_from_note(note: number) {
	return 440 * Math.pow(2, (note - 69) / 12);
}

function cents_off_from_pitch(frequency: number, note: number) {
	return Math.floor(1200 * Math.log(frequency / frequency_from_note(note)) / Math.log(2));
}


class AudioManager {
    // Chrome allows up to 2 ** 15, but this performs well enough.
    static SAMPLE_RATE = 44100;
    static FFT_SIZE = 2 ** 14;
    
    private analyser: AnalyserNode;
    private on_pitch_detection: (number) => any;
    
    constructor() {
        // Sets stuff up.
        let audio_context = new AudioContext();
        // This isn't set up to be cross platform, but that's okay.
        (<any> navigator).webkitGetUserMedia({
            "audio": {
                "mandatory": {
                    "googEchoCancellation": "false",
                    "googAutoGainControl": "false",
                    "googNoiseSuppression": "false",
                    "googHighpassFilter": "false"
                },
                "optional": []
            },
        }, (stream: any) => {
            // `stream` is really a MediaStream object.
            let stream_source = (<any> audio_context).createMediaStreamSource(stream);

            this.analyser = audio_context.createAnalyser();
            this.analyser.fftSize = AudioManager.FFT_SIZE;
            this.analyser.minDecibels = -110;
            this.analyser.maxDecibels = -30;

            stream_source.connect(this.analyser);
            this.check_pitch();
        }, function on_error(error: any) {
            console.log("Error connecting to microphone. " + error.message);
            alert("Looks like you might not have a microphone, or you might need to allow permission.");
        });
    }

    private harmonic_product_spectrum(frequency_domain: Uint8Array, compressed_frequency_domain: Float32Array) {
        assert(this.analyser.frequencyBinCount == AudioManager.FFT_SIZE / 2);
        assert(frequency_domain.length === this.analyser.frequencyBinCount);
        assert(compressed_frequency_domain.length === this.analyser.frequencyBinCount);

        for (var i = 0; i < frequency_domain.length; i++) {
            compressed_frequency_domain[i] = frequency_domain[i];
        }

        for (var downsampling_factor = 2; downsampling_factor <= 4; downsampling_factor++) {
            for (var i = 0; i < frequency_domain.length / downsampling_factor; i++) {
                // Downsample with a box filter.
                var to_multiply;
                if (downsampling_factor === 1) {
                    to_multiply = frequency_domain[i * downsampling_factor];
                } else if (downsampling_factor === 2) {
                    to_multiply = frequency_domain[i * downsampling_factor] * .5;
                    to_multiply += frequency_domain[(i * downsampling_factor) -1] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) +1] * .25;
                } else if (downsampling_factor === 3) {
                    to_multiply = frequency_domain[i * downsampling_factor] * (1/3);
                    to_multiply += frequency_domain[(i * downsampling_factor) -1] * (1/3);
                    to_multiply += frequency_domain[(i * downsampling_factor) +1] * (1/3);
                } else if (downsampling_factor === 4) {
                    to_multiply = frequency_domain[i * downsampling_factor] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) -1] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) -2] * .125;
                    to_multiply += frequency_domain[(i * downsampling_factor) +1] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) +2] * .125;
                } else {
                    assert(false);
                } 
                compressed_frequency_domain[i] *= to_multiply;
            }
        }
    }

    private check_pitch() {        
        requestAnimationFrame(this.check_pitch.bind(this));

        let float_frequency_data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(float_frequency_data);

        let WIDTH = $(window).width() + 40;  // Some extra love.
        let HEIGHT = $(window).height() / 1.5; 

        let canvas = <HTMLCanvasElement> document.getElementById('visualizer');
        let drawContext = (<any> canvas).getContext('2d');

        // Reset width/heigh in case the window has changed. This also clears the canvas.
        canvas.width = WIDTH;
        canvas.height = HEIGHT;

        // Draw the visualizer.
        let num_bars = float_frequency_data.length;
        let bar_width = WIDTH / num_bars;

        let log_length = Math.log(float_frequency_data.length) / Math.log(10);
        for (let i = 0; i < num_bars; i++) {
            let exp_idx = (i / float_frequency_data.length) * log_length;
            let idx = Math.round(Math.pow(10, exp_idx));
            
            let value = float_frequency_data[idx];
            let percent = value / 256;
            let height = HEIGHT * percent;
            let offset = HEIGHT - height - 1;     

            let hue = i/this.analyser.frequencyBinCount * 360;
            drawContext.fillStyle = 'hsl(' + hue + ', 100%, 50%)';
            drawContext.fillRect(i * bar_width, offset, bar_width, height);
        }

        // Now look for peaks so that we can label them!
        let peaks = [];
        for (let i = 1; i < num_bars - 1; i++) {
            if (float_frequency_data[i] > float_frequency_data[i - 1] && 
                    float_frequency_data[i] > float_frequency_data[i + 1]) {
                peaks.push(i);
            }
        }

        peaks.sort((a, b) => {return float_frequency_data[b] - float_frequency_data[a]});

        let peaks_rendered = [];
        for (let j = 0; j < peaks.length; j++) {
            if (peaks_rendered.length == 5) {
                break;
            }

            let i = peaks[j];

            // Where does `i` go on the logarithmic x-axis?
            let x_start = Math.log(i) / Math.log(10) / log_length;
            x_start *= WIDTH; 

            // Check if this is very close to another peak, if so skip it.
            let has_close_neighbor = false;
            for (let peak_x_start of peaks_rendered) {
                if (Math.abs(peak_x_start - x_start) < 50) {
                    has_close_neighbor = true;
                    break;
                }
            }
            if (has_close_neighbor)
                continue;

            peaks_rendered.push(x_start);

            // Place the letter ~20 pixels above the peak itself.
            let value = float_frequency_data[i];
            let percent = value / 256;
            let height = HEIGHT * percent;
            let y_start = HEIGHT - height - 1 - 20;     
            
            // Note that the coloring is not logarithmic, it's linear.
            let hue = (x_start / bar_width) / this.analyser.frequencyBinCount * 360;
            drawContext.fillStyle = 'hsl(' + hue + ', 100%, 50%)';

            let frequency = Math.round(i * AudioManager.SAMPLE_RATE / AudioManager.FFT_SIZE);
            drawContext.font = "30px Roboto Slab";
            drawContext.textAlign = "center";
            let text = note_name_from_note(note_from_pitch(frequency));
            drawContext.fillText(text, x_start, y_start + 10); 
        }
        

        let compressed_frequency_data = new Float32Array(this.analyser.frequencyBinCount);
        this.harmonic_product_spectrum(float_frequency_data, compressed_frequency_data);

        let max_idx = -1;
        let max_value = -1;
        for (var i = 0; i < compressed_frequency_data.length; i++) {
            if (compressed_frequency_data[i] > max_value) {
                max_idx = i;
                max_value = compressed_frequency_data[i];
            }
        }
        
        var frequency = max_idx * AudioManager.SAMPLE_RATE / AudioManager.FFT_SIZE;
        if (frequency <= 0)
            return;
        this.on_pitch_detection(frequency);

    }

    public set_pitch_detection_callback(fn: (number) => any) {
        this.on_pitch_detection = fn;
    }
}

class KnobUIManager {
    private knob: JQuery;
    private knob_color: string;
    private middle_text: JQuery;

    constructor() {
        this.middle_text = $("#middle-text");        
        (<any> $("#dial")).knob({
            width: 300,
            height: 300,
            readOnly: true,
            format: (value) => {
                return value + '%';
            },
            displayInput: false,
        });        
        this.knob = (<any> $("#dial"));

        // Make the dial transleucent to avoid clobbering visualizer. `prev` gets the canvas element.
        $("#dial").prev().css('opacity', 0.9);  
    }

    public animate_knob(start: number, 
                        end: number, 
                        color: string,
                        duration_ms: number,
                        on_complete?: () => any) {
        this.knob.val(start).trigger('change');
        this.knob.trigger(
            'configure',
            {
                fgColor: color,
            }
        );
        this.knob.animate({
                value: end,                
            }, { 
                duration: duration_ms,
                easing: 'linear',
                progress: () => {
                    // Make sure the UI is updated to match the new value.
                    this.knob.trigger('change');
                },
                complete: on_complete
            }
        );
    }
    
    public set_text(text: string) {
        this.middle_text.text(text);
        this.middle_text.css('color', this.knob_color);
    }

    public set_color(text: string) {
        this.knob_color = text;
        this.middle_text.css('color', this.knob_color);
        this.knob.trigger(
            'configure',
            {
                fgColor: text,
            }
        );
    }
}

class PianoRecordingManager {    
    private audio_by_midi_note: {[key: number]: HTMLAudioElement}; 

    constructor() {
        this.audio_by_midi_note = {
            48: new Audio('piano/3C.ogg'),
            49: new Audio('piano/3Cs.ogg'),
            50: new Audio('piano/3D.ogg'),
            51: new Audio('piano/3Ds.ogg'),
            52: new Audio('piano/3E.ogg'),
            53: new Audio('piano/3F.ogg'),
            54: new Audio('piano/3Fs.ogg'),
            55: new Audio('piano/3G.ogg'),
            56: new Audio('piano/3Gs.ogg'),
            57: new Audio('piano/3A.ogg'),
            58: new Audio('piano/3As.ogg'),
            59: new Audio('piano/3B.ogg'),
            60: new Audio('piano/4C.ogg'),
            61: new Audio('piano/4Cs.ogg'),
            62: new Audio('piano/4D.ogg'),
            63: new Audio('piano/4Ds.ogg'),
            64: new Audio('piano/4E.ogg'),
            65: new Audio('piano/4F.ogg'),
            66: new Audio('piano/4Fs.ogg'),
            67: new Audio('piano/4G.ogg'),
            68: new Audio('piano/4Gs.ogg'),		
            69: new Audio('piano/4A.ogg'),
            70: new Audio('piano/4As.ogg'),
            71: new Audio('piano/4B.ogg'),
            72: new Audio('piano/5C.ogg'),
        }
    }

    public play_note(note: number) {
        // Plays the note for 1s!
        
        let audio = this.audio_by_midi_note[note];
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
        audio.play();

        // Fade out over 1s.
        $(audio).animate({volume: 0}, 1000);
    }
}

class PitchPro {
    private ui_manager: KnobUIManager;
    private recording_manager: PianoRecordingManager;
    private audio_manager: AudioManager;

    private listening: boolean = false;
    private active_note: number;
    private last_received_note: number;

    private num_attempts = 0;
    private num_correct = 0;
    

    constructor(ui_manager: KnobUIManager, 
                recording_manager: PianoRecordingManager,
                audio_manager: AudioManager) {
        this.ui_manager = ui_manager;
        this.recording_manager = recording_manager;
        this.audio_manager = audio_manager;
        this.audio_manager.set_pitch_detection_callback((freq) => this.handle_pitch_detection(freq));

        // Set up listener on spacebar to start next tone.
        $(window).keypress((e) => {
            if (e.keyCode === 32) {
                e.preventDefault(); 
                this.attempt_random();
            };
        }); 
    }

    private attempt_random() {
        let note = Math.round(Math.random() * (60 - 48) + 48);
        let interval = parseInt($("#interval-selection").val());
        
        this.attempt(note, interval);
    }

    private attempt(note: number, interval: number) {
        if (this.active_note != null) {
            return;
        }

        // Clear the shown note, since we might be showing that from a previous round.
        this.ui_manager.set_color("black");
        this.ui_manager.set_text("");

        this.active_note = note;
        this.recording_manager.play_note(this.active_note);

        this.num_attempts += 1;
        let expected_note = note + interval;

        this.ui_manager.animate_knob(100, 0, 'grey', 1100, () => { 
            // Once the countdown of playing the note is done, show the recording animation.
            this.listening = true;
            this.ui_manager.animate_knob(0, 100, 'orange', 1500, () => { 
                // We're done recording, see how we did!
                
                let html = "";
                if (this.last_received_note == null) {
                    // Incorrect but no input.
                    this.ui_manager.set_color('red');
                    if (interval != 0) {
                        html += "You didn't sing, but we expected the " + INTERVAL_NAMES[interval]
                                    + " above " + note_name_from_note(note) 
                                    + " (which is <b>" + note_name_from_note(expected_note) + "</b>). ";

                    } else {
                        html += "You didn't sing, but we expected <b>" + note_name_from_note(note) + "</b>. ";
                    }

                } else if ((note + interval) % 12 != this.last_received_note % 12) {                    
                    // Incorrect.
                    this.ui_manager.set_color('red');

                    if (interval != 0) {
                        html += "You sang <b>" + note_name_from_note(this.last_received_note)
                                + "</b> but the " + INTERVAL_NAMES[interval]
                                + " above " + note_name_from_note(note) 
                                + " is <b>" + note_name_from_note(expected_note) + "</b>. ";
                    } else {
                        html += "You sang <b>" + note_name_from_note(this.last_received_note)
                                + "</b> but we expected <b>" + note_name_from_note(expected_note) + "</b>. ";
                    }
                                
                } else {
                    // Correct!
                    this.ui_manager.set_color('green');
                    this.num_correct += 1;

                    if (interval != 0) {
                        html += "Correct! You sang <b>" + note_name_from_note(this.last_received_note)
                                    + "</b> which is the " + INTERVAL_NAMES[interval]
                                    + " above " + note_name_from_note(note) + ". ";
                    } else {
                        html += "Correct! You sang <b>" + note_name_from_note(this.last_received_note) + "</b>. ";
                    }
                }

                html += "You've correctly sung " + this.num_correct + " out of " + this.num_attempts
                            + " intervals (" + Math.round(this.num_correct/this.num_attempts * 100) + "%). "
                $("#feedback").empty();
                $("#feedback").html(html);

                
                $(' <a>', {
                    text: interval != 0 ? 'Hear interval' : 'Hear note',
                    href: '#',
                    click: () => {
                        this.recording_manager.play_note(note);
                        if (interval != 0) {
                            // Only do this if we attempted an interval (non-unison).
                            setTimeout(() => {
                                this.recording_manager.play_note(expected_note);
                            }, 1000);
                        }                        
                    },
                }).appendTo($("#feedback"));
                $("#feedback").append(" or ");
                $(' <a>', {
                    text: 'retry',                    
                    href: '#',
                    click: () => {
                        this.attempt(note, interval);             
                    },
                }).appendTo($("#feedback"));
                $("#feedback").append(".");

                this.last_received_note = null;
                this.active_note = null;
                this.listening = false;
               
            });
        });
    }

    private handle_pitch_detection(frequency: number) {
        if (this.active_note == null) {
            // This means no sound has been placed to the user yet.
            return;
        }

        // We might want to show somewhere for debug, but for now don't do this if we're not listening yet.
        if (!this.listening) {
            return;
        }

        var note = note_from_pitch(frequency);
        let note_name = NOTE_NAMES[note % 12];
        var detune = cents_off_from_pitch(frequency, note);

        this.last_received_note = note;
        
        this.ui_manager.set_text(note_name);
    }


}
window.onload = function () {
    const launchButton = document.getElementById('launch-button');
    const intervalControl = document.getElementById('interval-control');
    let ui_manager = new KnobUIManager();

    launchButton.addEventListener('click', () => {
        launchButton.style.display = 'none';
        intervalControl.style.display = null;

        let audio_manager = new AudioManager();
        let recording_manager = new PianoRecordingManager();
        new PitchPro(ui_manager, recording_manager, audio_manager);
    })
}