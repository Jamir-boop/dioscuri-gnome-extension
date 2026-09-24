// Minimal GTK 4 client window used by the end-to-end test.
// Usage: gjs -m window.js <title>
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import system from 'system';

const [title = 'window'] = system.programArgs;
Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const window = new Gtk.Window({title, default_width: 480, default_height: 320});
window.set_child(new Gtk.Label({label: title}));
window.connect('close-request', () => {
    loop.quit();
    return false;
});
window.present();
loop.run();
