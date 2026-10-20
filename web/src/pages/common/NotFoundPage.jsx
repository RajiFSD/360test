import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../../components/States';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      message="The page you are looking for doesn't exist or you don't have access to it."
      action={
        <Link
          to="/"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Go to my home
        </Link>
      }
    />
  );
}
