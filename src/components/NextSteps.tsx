import { Link } from 'react-router-dom';
import '../styles/NextSteps.css';

interface NextStepsProps {
  hasBackupFolders: boolean;
  hasConnectedPeers: boolean;
}

interface StepCardProps {
  icon: string;
  title: string;
  description: string;
  action: React.ReactNode;
  completed?: boolean;
}

function StepCard({ icon, title, description, action, completed }: StepCardProps) {
  return (
    <div className={`next-step-card ${completed ? 'completed' : ''}`}>
      <div className="next-step-icon">{icon}</div>
      <div className="next-step-content">
        <h4 className="next-step-title">
          {completed && <span className="check-mark">✓</span>}
          {title}
        </h4>
        <p className="next-step-description">{description}</p>
      </div>
      <div className="next-step-action">
        {action}
      </div>
    </div>
  );
}

function NextSteps({ hasBackupFolders, hasConnectedPeers }: NextStepsProps) {
  // Don't show if all steps are completed
  const allDone = hasBackupFolders && hasConnectedPeers;

  if (allDone) {
    return null;
  }

  return (
    <div className="next-steps-panel">
      <h3>Next Steps</h3>
      <p className="next-steps-intro">
        Complete these steps to get the most out of Archivist
      </p>

      <div className="next-steps-list">
        <StepCard
          icon="📁"
          title="Add a Backup Folder"
          description="Choose a folder to automatically backup to the decentralized network"
          action={
            <Link to="/sync" className="btn-next-step">
              Add Folder
            </Link>
          }
          completed={hasBackupFolders}
        />

        <StepCard
          icon="🔗"
          title="Connect a Device"
          description="Link another device to sync files between your computers"
          action={
            <Link to="/devices/add" className="btn-next-step">
              Add Device
            </Link>
          }
          completed={hasConnectedPeers}
        />

        <StepCard
          icon="📥"
          title="Restore a File"
          description="Download a file from the network using its CID"
          action={
            <Link to="/files" className="btn-next-step secondary">
              Go to Restore
            </Link>
          }
        />
      </div>
    </div>
  );
}

export default NextSteps;
