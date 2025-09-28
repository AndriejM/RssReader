package pl.andriejsoft.rssreader.repository;

import org.springframework.data.mongodb.repository.MongoRepository;
import pl.andriejsoft.rssreader.document.Config;
import pl.andriejsoft.rssreader.document.User;

import java.util.Optional;

public interface UserRepository extends MongoRepository<User, String> {
    Optional<User> findByUuid(String uuid);

    Optional<User> findByUserName(String userName);

    User deleteByUuid(String uuid);
}
