import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Commissioner from "./pages/Commissioner";
import DraftBoard from "./pages/DraftBoard";
import Home from "./pages/Home";
import Leaderboards from "./pages/Leaderboards";
import NotFound from "./pages/NotFound";
import Standings from "./pages/Standings";
import Team from "./pages/Team";
import Weekly from "./pages/Weekly";

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/standings" component={Standings} />
    <Route path="/draft" component={DraftBoard} />
    <Route path="/leaders" component={Leaderboards} />
    <Route path="/weekly" component={Weekly} />
    <Route path="/team/:ownerId" component={Team} />
    <Route path="/commissioner" component={Commissioner} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
