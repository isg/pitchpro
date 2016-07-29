/// <reference path="jquery.d.ts" />
function assert(expression) {
    if (!expression) {
        throw new Error("AssertionError!");
    }
}
var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var INTERVAL_NAMES = ["unison", "minor second", "major second", "minor third", "major third",
    "perfect fourth", "tritone", "perfect fifth", "minor sixth", "major sixth",
    "minor seventh", "major seventh"];
function note_name_from_note(note) {
    var mod = note % 12;
    if (mod < 0) {
        mod += 12;
    }
    return NOTE_NAMES[mod];
}
function note_from_pitch(frequency) {
    var note_num = 12 * (Math.log(frequency / 440) / Math.log(2));
    return Math.round(note_num) + 69;
}
function frequency_from_note(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}
function cents_off_from_pitch(frequency, note) {
    return Math.floor(1200 * Math.log(frequency / frequency_from_note(note)) / Math.log(2));
}
var AudioManager = (function () {
    function AudioManager() {
        var _this = this;
        // Sets stuff up.
        var audio_context = new AudioContext();
        // This isn't set up to be cross platform, but that's okay.
        navigator.webkitGetUserMedia({
            "audio": {
                "mandatory": {
                    "googEchoCancellation": "false",
                    "googAutoGainControl": "false",
                    "googNoiseSuppression": "false",
                    "googHighpassFilter": "false"
                },
                "optional": []
            }
        }, function (stream) {
            // `stream` is really a MediaStream object.
            var stream_source = audio_context.createMediaStreamSource(stream);
            _this.analyser = audio_context.createAnalyser();
            _this.analyser.fftSize = AudioManager.FFT_SIZE;
            _this.analyser.minDecibels = -110;
            _this.analyser.maxDecibels = -30;
            stream_source.connect(_this.analyser);
            _this.check_pitch();
        }, function on_error(error) {
            console.log("Error connecting to microphone. " + error.message);
            alert("Looks like you might not have a microphone, or you might need to allow permission.");
        });
    }
    AudioManager.prototype.harmonic_product_spectrum = function (frequency_domain, compressed_frequency_domain) {
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
                }
                else if (downsampling_factor === 2) {
                    to_multiply = frequency_domain[i * downsampling_factor] * .5;
                    to_multiply += frequency_domain[(i * downsampling_factor) - 1] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) + 1] * .25;
                }
                else if (downsampling_factor === 3) {
                    to_multiply = frequency_domain[i * downsampling_factor] * (1 / 3);
                    to_multiply += frequency_domain[(i * downsampling_factor) - 1] * (1 / 3);
                    to_multiply += frequency_domain[(i * downsampling_factor) + 1] * (1 / 3);
                }
                else if (downsampling_factor === 4) {
                    to_multiply = frequency_domain[i * downsampling_factor] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) - 1] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) - 2] * .125;
                    to_multiply += frequency_domain[(i * downsampling_factor) + 1] * .25;
                    to_multiply += frequency_domain[(i * downsampling_factor) + 2] * .125;
                }
                else {
                    assert(false);
                }
                compressed_frequency_domain[i] *= to_multiply;
            }
        }
    };
    AudioManager.prototype.check_pitch = function () {
        requestAnimationFrame(this.check_pitch.bind(this));
        var float_frequency_data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(float_frequency_data);
        var WIDTH = $(window).width() + 40; // Some extra love.
        var HEIGHT = $(window).height() / 1.5;
        var canvas = document.getElementById('visualizer');
        var drawContext = canvas.getContext('2d');
        // Reset width/heigh in case the window has changed. This also clears the canvas.
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        // Draw the visualizer.
        var num_bars = float_frequency_data.length;
        var bar_width = WIDTH / num_bars;
        var log_length = Math.log(float_frequency_data.length) / Math.log(10);
        for (var i_1 = 0; i_1 < num_bars; i_1++) {
            var exp_idx = (i_1 / float_frequency_data.length) * log_length;
            var idx = Math.round(Math.pow(10, exp_idx));
            var value = float_frequency_data[idx];
            var percent = value / 256;
            var height = HEIGHT * percent;
            var offset = HEIGHT - height - 1;
            var hue = i_1 / this.analyser.frequencyBinCount * 360;
            drawContext.fillStyle = 'hsl(' + hue + ', 100%, 50%)';
            drawContext.fillRect(i_1 * bar_width, offset, bar_width, height);
        }
        // Now look for peaks so that we can label them!
        var peaks = [];
        for (var i_2 = 1; i_2 < num_bars - 1; i_2++) {
            if (float_frequency_data[i_2] > float_frequency_data[i_2 - 1] &&
                float_frequency_data[i_2] > float_frequency_data[i_2 + 1]) {
                peaks.push(i_2);
            }
        }
        peaks.sort(function (a, b) { return float_frequency_data[b] - float_frequency_data[a]; });
        var peaks_rendered = [];
        for (var j = 0; j < peaks.length; j++) {
            if (peaks_rendered.length == 5) {
                break;
            }
            var i_3 = peaks[j];
            // Where does `i` go on the logarithmic x-axis?
            var x_start = Math.log(i_3) / Math.log(10) / log_length;
            x_start *= WIDTH;
            // Check if this is very close to another peak, if so skip it.
            var has_close_neighbor = false;
            for (var _i = 0, peaks_rendered_1 = peaks_rendered; _i < peaks_rendered_1.length; _i++) {
                var peak_x_start = peaks_rendered_1[_i];
                if (Math.abs(peak_x_start - x_start) < 50) {
                    has_close_neighbor = true;
                    break;
                }
            }
            if (has_close_neighbor)
                continue;
            peaks_rendered.push(x_start);
            // Place the letter ~20 pixels above the peak itself.
            var value = float_frequency_data[i_3];
            var percent = value / 256;
            var height = HEIGHT * percent;
            var y_start = HEIGHT - height - 1 - 20;
            // Note that the coloring is not logarithmic, it's linear.
            var hue = (x_start / bar_width) / this.analyser.frequencyBinCount * 360;
            drawContext.fillStyle = 'hsl(' + hue + ', 100%, 50%)';
            var frequency_1 = Math.round(i_3 * AudioManager.SAMPLE_RATE / AudioManager.FFT_SIZE);
            drawContext.font = "30px Roboto Slab";
            drawContext.textAlign = "center";
            var text = note_name_from_note(note_from_pitch(frequency_1));
            drawContext.fillText(text, x_start, y_start + 10);
        }
        var compressed_frequency_data = new Float32Array(this.analyser.frequencyBinCount);
        this.harmonic_product_spectrum(float_frequency_data, compressed_frequency_data);
        var max_idx = -1;
        var max_value = -1;
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
    };
    AudioManager.prototype.set_pitch_detection_callback = function (fn) {
        this.on_pitch_detection = fn;
    };
    // Chrome allows up to 2 ** 15, but this performs well enough.
    AudioManager.SAMPLE_RATE = 44100;
    AudioManager.FFT_SIZE = Math.pow(2, 14);
    return AudioManager;
}());
var KnobUIManager = (function () {
    function KnobUIManager() {
        this.middle_text = $("#middle-text");
        $("#dial").knob({
            width: 300,
            height: 300,
            readOnly: true,
            format: function (value) {
                return value + '%';
            },
            displayInput: false
        });
        this.knob = $("#dial");
        // Make the dial transleucent to avoid clobbering visualizer. `prev` gets the canvas element.
        $("#dial").prev().css('opacity', 0.9);
    }
    KnobUIManager.prototype.animate_knob = function (start, end, color, duration_ms, on_complete) {
        var _this = this;
        this.knob.val(start).trigger('change');
        this.knob.trigger('configure', {
            fgColor: color
        });
        this.knob.animate({
            value: end
        }, {
            duration: duration_ms,
            easing: 'linear',
            progress: function () {
                // Make sure the UI is updated to match the new value.
                _this.knob.trigger('change');
            },
            complete: on_complete
        });
    };
    KnobUIManager.prototype.set_text = function (text) {
        this.middle_text.text(text);
        this.middle_text.css('color', this.knob_color);
    };
    KnobUIManager.prototype.set_color = function (text) {
        this.knob_color = text;
        this.middle_text.css('color', this.knob_color);
        this.knob.trigger('configure', {
            fgColor: text
        });
    };
    return KnobUIManager;
}());
var PianoRecordingManager = (function () {
    function PianoRecordingManager() {
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
            72: new Audio('piano/5C.ogg')
        };
    }
    PianoRecordingManager.prototype.play_note = function (note) {
        // Plays the note for 1s!
        var audio = this.audio_by_midi_note[note];
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
        audio.play();
        // Fade out over 1s.
        $(audio).animate({ volume: 0 }, 1000);
    };
    return PianoRecordingManager;
}());
var PitchPro = (function () {
    function PitchPro(ui_manager, recording_manager, audio_manager) {
        var _this = this;
        this.listening = false;
        this.num_attempts = 0;
        this.num_correct = 0;
        this.ui_manager = ui_manager;
        this.recording_manager = recording_manager;
        this.audio_manager = audio_manager;
        this.audio_manager.set_pitch_detection_callback(function (freq) { return _this.handle_pitch_detection(freq); });
        // Set up listener on spacebar to start next tone.
        $(window).keypress(function (e) {
            if (e.keyCode === 32) {
                e.preventDefault();
                _this.attempt_random();
            }
            ;
        });
    }
    PitchPro.prototype.attempt_random = function () {
        var note = Math.round(Math.random() * (60 - 48) + 48);
        var interval = parseInt($("#interval-selection").val());
        this.attempt(note, interval);
    };
    PitchPro.prototype.attempt = function (note, interval) {
        var _this = this;
        if (this.active_note != null) {
            return;
        }
        // Clear the shown note, since we might be showing that from a previous round.
        this.ui_manager.set_color("black");
        this.ui_manager.set_text("");
        this.active_note = note;
        this.recording_manager.play_note(this.active_note);
        this.num_attempts += 1;
        var expected_note = note + interval;
        this.ui_manager.animate_knob(100, 0, 'grey', 1100, function () {
            // Once the countdown of playing the note is done, show the recording animation.
            _this.listening = true;
            _this.ui_manager.animate_knob(0, 100, 'orange', 1500, function () {
                // We're done recording, see how we did!
                var html = "";
                if (_this.last_received_note == null) {
                    // Incorrect but no input.
                    _this.ui_manager.set_color('red');
                    if (interval != 0) {
                        html += "You didn't sing, but we expected the " + INTERVAL_NAMES[interval]
                            + " above " + note_name_from_note(note)
                            + " (which is <b>" + note_name_from_note(expected_note) + "</b>). ";
                    }
                    else {
                        html += "You didn't sing, but we expected <b>" + note_name_from_note(note) + "</b>. ";
                    }
                }
                else if ((note + interval) % 12 != _this.last_received_note % 12) {
                    // Incorrect.
                    _this.ui_manager.set_color('red');
                    if (interval != 0) {
                        html += "You sang <b>" + note_name_from_note(_this.last_received_note)
                            + "</b> but the " + INTERVAL_NAMES[interval]
                            + " above " + note_name_from_note(note)
                            + " is <b>" + note_name_from_note(expected_note) + "</b>. ";
                    }
                    else {
                        html += "You sang <b>" + note_name_from_note(_this.last_received_note)
                            + "</b> but we expected <b>" + note_name_from_note(expected_note) + "</b>. ";
                    }
                }
                else {
                    // Correct!
                    _this.ui_manager.set_color('green');
                    _this.num_correct += 1;
                    if (interval != 0) {
                        html += "Correct! You sang <b>" + note_name_from_note(_this.last_received_note)
                            + "</b> which is the " + INTERVAL_NAMES[interval]
                            + " above " + note_name_from_note(note) + ". ";
                    }
                    else {
                        html += "Correct! You sang <b>" + note_name_from_note(_this.last_received_note) + "</b>. ";
                    }
                }
                html += "You've correctly sung " + _this.num_correct + " out of " + _this.num_attempts
                    + " intervals (" + Math.round(_this.num_correct / _this.num_attempts * 100) + "%). ";
                $("#feedback").empty();
                $("#feedback").html(html);
                $(' <a>', {
                    text: interval != 0 ? 'Hear interval' : 'Hear note',
                    href: '#',
                    click: function () {
                        _this.recording_manager.play_note(note);
                        if (interval != 0) {
                            // Only do this if we attempted an interval (non-unison).
                            setTimeout(function () {
                                _this.recording_manager.play_note(expected_note);
                            }, 1000);
                        }
                    }
                }).appendTo($("#feedback"));
                $("#feedback").append(" or ");
                $(' <a>', {
                    text: 'retry',
                    href: '#',
                    click: function () {
                        _this.attempt(note, interval);
                    }
                }).appendTo($("#feedback"));
                $("#feedback").append(".");
                _this.last_received_note = null;
                _this.active_note = null;
                _this.listening = false;
            });
        });
    };
    PitchPro.prototype.handle_pitch_detection = function (frequency) {
        if (this.active_note == null) {
            // This means no sound has been placed to the user yet.
            return;
        }
        // We might want to show somewhere for debug, but for now don't do this if we're not listening yet.
        if (!this.listening) {
            return;
        }
        var note = note_from_pitch(frequency);
        var note_name = NOTE_NAMES[note % 12];
        var detune = cents_off_from_pitch(frequency, note);
        this.last_received_note = note;
        this.ui_manager.set_text(note_name);
    };
    return PitchPro;
}());
window.onload = function () {
    var audio_manager = new AudioManager();
    var recording_manager = new PianoRecordingManager();
    var ui_manager = new KnobUIManager();
    var pitch_pro = new PitchPro(ui_manager, recording_manager, audio_manager);
};
