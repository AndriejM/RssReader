package pl.andriejsoft.rssreader.repository;

import org.springframework.data.mongodb.repository.MongoRepository;
import pl.andriejsoft.rssreader.document.Group;
import pl.andriejsoft.rssreader.document.User;

import java.util.Optional;

public interface GroupRepository extends MongoRepository<Group, String> {
    Optional<Group> findByUuid(String uuid);

    Group deleteByUuid(String uuid);
}
