"""Matplotlib backend for runs outside notebooks: every shown figure becomes a PNG that Lattice displays.

Selected with MPLBACKEND=module://lattice_figures; LATTICE_FIGURES names the folder."""
import atexit
import os

from matplotlib._pylab_helpers import Gcf
from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg

FigureCanvas, FigureManager = FigureCanvasAgg, FigureManagerBase
_saved = [0]


def show(*args, **kwargs):
    folder = os.environ.get("LATTICE_FIGURES")
    for manager in Gcf.get_all_fig_managers():
        if folder:
            _saved[0] += 1
            manager.canvas.figure.savefig(os.path.join(folder, f"{_saved[0]:03d}.png"), dpi=100, bbox_inches="tight")
    Gcf.destroy_all()


# Figures drawn but never shown still reach the learner.
atexit.register(show)
