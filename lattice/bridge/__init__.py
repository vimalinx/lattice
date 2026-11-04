"""The bridge between the interface and the rest of Lattice; `Bridge` is put together from a part for each area."""
from .common import APP_HOME
from .core import Bridge

__all__ = ["APP_HOME", "Bridge"]
