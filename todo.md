# TODO

Overall, the docs should be more hands-on and interactive. The current format is too text-heavy and requires a lot of reading upfront. Consider adding interactive tutorials, visual aids, and progress indicators to enhance the learning experience. Interactive like an python notebook CS course lab: some stuff is written, and then you get to try things out. A mini-embedded area with specific blocks, as needed, a subset of features, as needed, etc. would allow for interactive learning. Think about design that is hands on but DOESN'T walk the user through every step. They should reason, think, and explore. The basic mechanics must be written out somewhat, but minimize "now click on the [x]" type instructions

Minor edits and thoughts are as follows

On the installation page, add a link to windows, mac, and linux installation instructions. This obviates scrolling to find the section.

Fix the docs/getting-started/editor layout diagram - it's malformed. It also shows things in a way that isn't quite right.

Upload test sketch should use some other way to cycle through the items. Maybe through the serial monitor, since you can send data back and forth.

Change test sketch color output to be mapped to 0-100.

Swap to the https://www.sparkfun.com/sparkfun-qwiic-alphanumeric-display-red.html instead of the current 7-seg.

Update /docs/guide/braitenberg-vehicles to include updated diagram pictures.

Fix /docs/guide/nodes to be in sync with the current node types and their descriptions.Also think about removing the technical details, adding a warning, or making it a drop-down / hidden section

Add some sort of visual for nodes that take multiple inputs? Maybe a squiggly input port? Not sure about this one. Might be fine as-is.

/docs/guide/connections needs ascii diagram(s) to become real diagrams. Example curve shape diagrams should look like the in-software ones (square aspect ratio) and maybe even should be interactive? Add a note that some of these are unneeded: e.g. inverted response is just a weight of -1. Any time the graph is a line through the origin, it can be represented as some weight. Design patterns should be shown as hands-on examples, not just as diagrams.

Bigger-picture: docs should not require lots of reading up front.It should be more hands-on.Kinesthetic learning. Can these be made into interactive tutorials?

non-linear weights should be visualized on the connection as a super-tiny diagram of their function instead of as a number.

/docs/guide/simulation should be introduced earlier through the embedded tutorials, not where it is now. In its own section or throughout the tutorials, there should be a guide on how to use the controls (not a set of "click here to do this" instructions, but hands-on exploration).

Add a progress bar or something to the upload sketch process to give feedback. Research shows that progress bars reduce frustration.

Add an overview video showing the software in action for the main page, including a tutorial, trace, upload, and running bot.
