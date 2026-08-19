import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ScrollToTop } from "./components/ScrollToTop";
import { ThemeProvider } from "./contexts/ThemeContext";
import Commissioner from "./pages/Commissioner";
import CommissionerRegistrations from "./pages/CommissionerRegistrations";
import DraftBoard from "./pages/DraftBoard";
import DraftResearch from "./pages/DraftResearch";
import Home from "./pages/Home";
import JoinLeague from "./pages/JoinLeague";
import Landing from "./pages/Landing";
import Leaderboards from "./pages/Leaderboards";
import MyDraft from "./pages/MyDraft";
import MyTeam from "./pages/MyTeam";
import NotFound from "./pages/NotFound";
import Prizes from "./pages/Prizes";
import Standings from "./pages/Standings";
import Team from "./pages/Team";
import Weekly from "./pages/Weekly";

function Router() {
  return <Switch>
    <Route path="/" component={Landing} />
    <Route path="/join" component={JoinLeague} />
    <Route path="/prizes" component={Prizes} />
    <Route path="/payment" component={Prizes} />
    <Route path="/standings" component={Standings} />
    <Route path="/draft" component={DraftBoard} />
    <Route path="/research" component={DraftResearch} />
    <Route path="/leaders" component={Leaderboards} />
    <Route path="/weekly" component={Weekly} />
    <Route path="/my-draft" component={MyDraft} />
    <Route path="/my-team" component={MyTeam} />
    <Route path="/team/:ownerId" component={Team} />
    <Route path="/commissioner" component={Commissioner} />
    <Route path="/commissioner/registrations" component={CommissionerRegistrations} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><ScrollToTop /><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
